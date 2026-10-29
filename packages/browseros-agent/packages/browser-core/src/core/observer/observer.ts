import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import type { FrameId } from '../connection'
import type { PageManager } from '../pages'
import { diffSnapshotObservations, type SnapshotDiff } from '../snapshot/diff'
import { type DocumentId, RefMap } from '../snapshot/refs'
import { renderSnapshot } from '../snapshot/render'
import { fetchAxTree } from './ax-tree'
import { findCursorHits } from './cursor-augment'
import type { FrameRegistry } from './frames'
import { type ResolvedElement, resolveRefEntry } from './resolve'

const MAX_FRAME_DEPTH = 5
const MAX_STABLE_CAPTURE_ATTEMPTS = 3

export interface SnapshotResult {
  text: string
  refs: RefMap
  url: string
}

/** Bounded, secret-free metadata for downstream challenge detection. */
export interface ChallengeSignal {
  urlOrigin: string
  urlPath: string
  visiblePasswordInputCount: number
  visibleOtpInputCount: number
  captchaIframeCount: number
  captchaProviderMarkerCount: number
  explicitChallengeState: 'none' | 'captcha' | 'mfa' | 'unknown'
  formState: 'none' | 'login' | 'consent' | 'challenge' | 'unknown'
}

const CHALLENGE_SIGNAL_JS = `(function(){
  var cap=20, nodeCap=3000, count=function(n){return Math.min(cap,n)};
  var visible=function(el){
    if(!el||!el.isConnected||el.type==='hidden'||el.disabled)return false;
    var r=el.getBoundingClientRect();
    if(r.width===0||r.height===0)return false;
    var depth=0;
    for(var p=el;p&&p.nodeType===1&&depth<32;p=p.parentElement,depth++){
      var s=getComputedStyle(p);
      if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)return false;
    }
    return !p;
  };
  var passwords=0,otps=0,frames=0,markers=0,hasVisibleForm=false,hasConsentCheckbox=false;
  var state='none';
  var root=document.body,walker=root&&document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT),visited=0,node;
  while(walker&&visited<nodeCap&&(node=walker.nextNode())){
    visited++;
    var tag=node.tagName.toLowerCase();
    if(!visible(node))continue;
    if(tag==='form')hasVisibleForm=true;
    if(tag==='input'){
      if(node.type==='password')passwords++;
      if(node.getAttribute('autocomplete')==='one-time-code')otps++;
      if(node.type==='checkbox'&&node.form)hasConsentCheckbox=true;
    }else if(tag==='iframe'){
      try{var h=new URL(node.src,location.href).hostname.toLowerCase();if(h==='google.com'||h.endsWith('.google.com')||h==='recaptcha.net'||h.endsWith('.recaptcha.net')||h==='hcaptcha.com'||h.endsWith('.hcaptcha.com')||h==='challenges.cloudflare.com')frames++}catch(_){}
    }
    if(node.hasAttribute('data-hcaptcha-widget-id')||node.hasAttribute('data-turnstile-widget')||node.classList.contains('g-recaptcha'))markers++;
    if(node.hasAttribute('data-challenge-state')){
      var v=node.getAttribute('data-challenge-state');
      if(v==='captcha'||v==='mfa')state=v;
      else if(v!==null&&v!=='none'&&state==='none')state='unknown';
    }
  }
  var formState='none';
  if(hasVisibleForm){
    if(otps>0)formState='challenge';else if(passwords>0)formState='login';
    else if(hasConsentCheckbox)formState='consent';
    else formState='unknown';
  }
  return {visiblePasswordInputCount:count(passwords),visibleOtpInputCount:count(otps),captchaIframeCount:count(frames),captchaProviderMarkerCount:count(markers),explicitChallengeState:state,formState:formState};
})()`

const EMPTY_CHALLENGE_SIGNAL: Omit<ChallengeSignal, 'urlOrigin' | 'urlPath'> = {
  visiblePasswordInputCount: 0,
  visibleOtpInputCount: 0,
  captchaIframeCount: 0,
  captchaProviderMarkerCount: 0,
  explicitChallengeState: 'none',
  formState: 'none',
}

interface MainFrameState {
  url: string
  documentId?: DocumentId
  frameDocuments: Map<FrameId | undefined, DocumentId>
}

interface RefScope {
  documentId: DocumentId
  url: string
}

interface CaptureResult extends SnapshotResult {
  scope?: RefScope
}

interface FrameTreeNode {
  frame: {
    id: FrameId
    loaderId?: string
    url?: string
    urlFragment?: string
  }
  childFrames?: FrameTreeNode[]
}

/** Per-page snapshot, ref, and diff state for one BrowserOS page id. */
export class Observer {
  private baseline?: { text: string; url: string }
  private refs = new RefMap()
  private refScope?: RefScope
  private lastSignals?: ChallengeSignal

  constructor(
    private readonly pages: PageManager,
    private readonly frames: FrameRegistry,
    private readonly pageId: number,
  ) {}

  async snapshot(): Promise<SnapshotResult> {
    const result = await this.capture()
    this.commit(result)
    return result
  }

  async diff(): Promise<SnapshotDiff> {
    const before = this.baseline
    const result = await this.capture()
    this.commit(result)
    return diffSnapshotObservations(before, result)
  }

  get lastRefs(): RefMap {
    return this.refs
  }

  get lastChallengeSignals(): ChallengeSignal | undefined {
    return this.lastSignals ? { ...this.lastSignals } : undefined
  }

  /** Collects only allowlisted challenge metadata; it never reads page text or field values. */
  async challengeSignals(): Promise<ChallengeSignal> {
    const { session } = await this.pages.getSession(this.pageId)
    let url = 'unknown'
    try {
      const tree = await session.Page.getFrameTree()
      url = frameUrl((tree.frameTree as FrameTreeNode).frame)
    } catch {
      // Keep the safe unknown URL when frame metadata is unavailable.
    }
    const safeUrl = projectSafeUrl(url)
    try {
      const result = await session.Runtime.evaluate({
        expression: CHALLENGE_SIGNAL_JS,
        returnByValue: true,
        awaitPromise: false,
      })
      const signals = {
        ...safeUrl,
        ...parseChallengeCounts(result.result?.value),
      }
      this.lastSignals = signals
      return { ...signals }
    } catch {
      const signals = { ...safeUrl, ...EMPTY_CHALLENGE_SIGNAL }
      this.lastSignals = signals
      return { ...signals }
    }
  }

  /** Resolve a ref from the last snapshot to a live element, routed to its frame's session. */
  async resolveRef(ref: string): Promise<ResolvedElement> {
    const entry = this.refs.get(ref)
    if (!entry) {
      throw new Error(`Unknown ref ${ref}; take a new snapshot.`)
    }
    await this.pages.getSession(this.pageId)
    const { session, axParams } = this.frames.resolveFrameTarget(
      this.pageId,
      entry.frameId,
    )
    return resolveRefEntry(session, entry, axParams)
  }

  private async capture(): Promise<CaptureResult> {
    const pageSession = await this.pages.getSession(this.pageId)
    for (let attempt = 0; attempt < MAX_STABLE_CAPTURE_ATTEMPTS; attempt++) {
      const before = await this.readMainFrameState(pageSession.session)
      const refs = this.refsForCapture(before)
      const text = await this.captureFrame(
        undefined,
        refs,
        0,
        new Set(),
        pageSession.session,
        before.frameDocuments,
      )
      const after = await this.readMainFrameState(pageSession.session)
      if (!knownMainFrameChanged(before, after)) {
        return { text, refs, url: after.url, scope: refScopeFrom(after) }
      }
    }
    throw new Error('Page document changed during snapshot capture; retry.')
  }

  /** Render a frame, then splice each child iframe's rendered tree under its `- iframe` line. */
  private async captureFrame(
    frameId: FrameId | undefined,
    refs: RefMap,
    baseDepth: number,
    visited: Set<FrameId>,
    rootSession: ProtocolApi,
    frameDocuments: Map<FrameId | undefined, DocumentId>,
  ): Promise<string> {
    if (frameId !== undefined) {
      if (visited.has(frameId)) return ''
      visited.add(frameId)
    }

    const { session, axParams } = this.frames.resolveFrameTarget(
      this.pageId,
      frameId,
    )
    const nodes = await fetchAxTree(session, axParams)
    const cursorHits = await findCursorHits(session).catch(
      () => new Map<number, string[]>(),
    )
    const documentId = await this.stableDocumentIdForFrame(
      rootSession,
      frameId,
      frameDocuments,
    )
    const { text, iframes } = renderSnapshot(nodes, {
      refs,
      frameId,
      documentId,
      baseDepth,
      cursorHits,
    })
    if (iframes.length === 0 || baseDepth >= MAX_FRAME_DEPTH) return text

    const lines = text.split('\n')
    // Splice bottom-up so earlier line indices stay valid as we insert.
    for (const stitch of [...iframes].reverse()) {
      const childFrameId = await resolveChildFrameId(
        session,
        stitch.backendNodeId,
      )
      if (!childFrameId) continue
      const childText = await this.captureFrame(
        childFrameId,
        refs,
        stitch.depth + 1,
        visited,
        rootSession,
        frameDocuments,
      ).catch(() => '')
      if (childText) lines.splice(stitch.lineIndex + 1, 0, childText)
    }
    return lines.join('\n')
  }

  private commit(result: CaptureResult): void {
    this.baseline = { text: result.text, url: result.url }
    this.refs = result.refs
    this.refScope = result.scope
  }

  private refsForCapture(state: MainFrameState): RefMap {
    if (shouldResetRefs(this.refScope, state)) return new RefMap()
    return this.refs.forkForSnapshot()
  }

  private async readMainFrameState(
    session: ProtocolApi,
  ): Promise<MainFrameState> {
    try {
      const result = await session.Page.getFrameTree()
      const tree = result.frameTree as FrameTreeNode
      return {
        url: frameUrl(tree.frame),
        documentId: frameDocumentId(tree.frame),
        frameDocuments: collectFrameDocuments(tree),
      }
    } catch {
      return {
        url: await this.readRegistryUrl(),
        frameDocuments: new Map(),
      }
    }
  }

  /** Reads the tab registry URL after frame-tree lookup has already failed. */
  private async readRegistryUrl(): Promise<string> {
    try {
      return (await this.pages.refresh(this.pageId))?.url ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  private async stableDocumentIdForFrame(
    rootSession: ProtocolApi,
    frameId: FrameId | undefined,
    frameDocuments: Map<FrameId | undefined, DocumentId>,
  ): Promise<DocumentId | undefined> {
    const beforeDocumentId = frameDocuments.get(frameId)
    if (frameId === undefined || beforeDocumentId === undefined) {
      return beforeDocumentId
    }

    const latest = await this.readFrameDocuments(rootSession).catch(
      () => undefined,
    )
    const afterDocumentId = latest?.get(frameId)
    return afterDocumentId === beforeDocumentId ? beforeDocumentId : undefined
  }

  private async readFrameDocuments(
    session: ProtocolApi,
  ): Promise<Map<FrameId | undefined, DocumentId>> {
    const result = await session.Page.getFrameTree()
    return collectFrameDocuments(result.frameTree as FrameTreeNode)
  }
}

function parseChallengeCounts(
  value: unknown,
): Omit<ChallengeSignal, 'urlOrigin' | 'urlPath'> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ...EMPTY_CHALLENGE_SIGNAL }
  const record = value as Record<string, unknown>
  const bounded = (n: unknown): number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
      ? Math.min(20, n)
      : 0
  const explicit = ['none', 'captcha', 'mfa', 'unknown'].includes(
    String(record.explicitChallengeState),
  )
    ? (record.explicitChallengeState as ChallengeSignal['explicitChallengeState'])
    : 'unknown'
  const form = ['none', 'login', 'consent', 'challenge', 'unknown'].includes(
    String(record.formState),
  )
    ? (record.formState as ChallengeSignal['formState'])
    : 'unknown'
  return {
    visiblePasswordInputCount: bounded(record.visiblePasswordInputCount),
    visibleOtpInputCount: bounded(record.visibleOtpInputCount),
    captchaIframeCount: bounded(record.captchaIframeCount),
    captchaProviderMarkerCount: bounded(record.captchaProviderMarkerCount),
    explicitChallengeState: explicit,
    formState: form,
  }
}

function projectSafeUrl(
  raw: string,
): Pick<ChallengeSignal, 'urlOrigin' | 'urlPath'> {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) {
      return { urlOrigin: 'https://invalid.invalid', urlPath: '/' }
    }
    return {
      urlOrigin:
        url.origin.length <= 255 ? url.origin : 'https://invalid.invalid',
      // Paths commonly contain account identifiers, email addresses, or tokens.
      urlPath: '/',
    }
  } catch {
    return { urlOrigin: 'https://invalid.invalid', urlPath: '/' }
  }
}

function knownUrlsDiffer(beforeUrl: string, afterUrl: string): boolean {
  return (
    beforeUrl !== 'unknown' && afterUrl !== 'unknown' && beforeUrl !== afterUrl
  )
}

function knownMainFrameChanged(
  before: MainFrameState,
  after: MainFrameState,
): boolean {
  if (knownUrlsDiffer(before.url, after.url)) return true
  return (
    before.documentId !== undefined &&
    after.documentId !== undefined &&
    before.documentId !== after.documentId
  )
}

function shouldResetRefs(
  current: RefScope | undefined,
  next: MainFrameState,
): boolean {
  if (current === undefined || next.documentId === undefined) return true
  if (current.documentId !== next.documentId) return true
  return knownUrlsDiffer(current.url, next.url)
}

function refScopeFrom(state: MainFrameState): RefScope | undefined {
  if (state.documentId === undefined) return undefined
  return { documentId: state.documentId, url: state.url }
}

function collectFrameDocuments(
  tree: FrameTreeNode,
): Map<FrameId | undefined, DocumentId> {
  const documents = new Map<FrameId | undefined, DocumentId>()

  function visit(node: FrameTreeNode, isRoot: boolean): void {
    const documentId = frameDocumentId(node.frame)
    if (documentId !== undefined) {
      documents.set(isRoot ? undefined : node.frame.id, documentId)
      documents.set(node.frame.id, documentId)
    }
    for (const child of node.childFrames ?? []) visit(child, false)
  }

  visit(tree, true)
  return documents
}

function frameDocumentId(
  frame: FrameTreeNode['frame'],
): DocumentId | undefined {
  if (frame.loaderId === undefined) return undefined
  return `${frame.id}:${frame.loaderId}`
}

function frameUrl(frame: FrameTreeNode['frame']): string {
  return frame.url ? `${frame.url}${frame.urlFragment ?? ''}` : 'unknown'
}

/** Resolve an iframe element to the frameId of its embedded document. */
async function resolveChildFrameId(
  session: ProtocolApi,
  backendNodeId: number,
): Promise<FrameId | undefined> {
  try {
    const described = await session.DOM.describeNode({
      backendNodeId,
      depth: 1,
    })
    const node = described.node as {
      contentDocument?: { frameId?: string }
      frameId?: string
    }
    return node.contentDocument?.frameId ?? node.frameId
  } catch {
    return undefined
  }
}
