import type { Node as DomNode } from '@browseros/cdp-protocol/domains/dom'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'

const MASK_ATTRIBUTE = 'data-browseros-screenshot-field-mask'

/** Temporarily hides editable values while retaining the page's layout. */
export async function installScreenshotFieldMask(
  session: ProtocolApi,
  token: string,
): Promise<void> {
  const tree = await session.DOM.getDocument({ depth: -1, pierce: true })
  if (containsClosedShadowRoot(tree.root)) {
    throw new Error('Closed shadow root prevents safe screenshot masking')
  }
  const attr = JSON.stringify(MASK_ATTRIBUTE)
  const marker = JSON.stringify(token)
  let result: Awaited<ReturnType<ProtocolApi['Runtime']['evaluate']>>
  try {
    result = await session.Runtime.evaluate({
      expression: `(() => {
      var attr = ${attr};
      var token = ${marker};
      var css = 'input,textarea,select{color:transparent!important;-webkit-text-fill-color:transparent!important;-webkit-text-security:disc!important;text-shadow:none!important;caret-color:transparent!important}input::placeholder,textarea::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}input::selection,textarea::selection{color:transparent!important;background:transparent!important}[contenteditable],[contenteditable] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}[contenteditable]::selection,[contenteditable] *::selection{color:transparent!important;background:transparent!important}iframe[' + attr + '="' + token + '"],frame[' + attr + '="' + token + '"]{visibility:hidden!important}';
      var seen = new Set();
      function transparent(value) {
        return value === 'transparent' || /^rgba\\([^)]*,\\s*0(?:\\.0+)?\\s*\\)$/.test(value);
      }
      function visit(root, doc) {
        if (!root || seen.has(root)) return;
        seen.add(root);
        var style = doc.createElement('style');
        style.setAttribute(attr, token);
        style.textContent = css;
        (root.nodeType === 9 ? (root.head || root.documentElement) : root).appendChild(style);
        var controls = root.querySelectorAll('input,textarea,select,[contenteditable],[contenteditable] *');
        for (var c = 0; c < controls.length; c++) {
          var computed = doc.defaultView.getComputedStyle(controls[c]);
          if (!transparent(computed.color) || !transparent(computed.webkitTextFillColor) || computed.textShadow !== 'none') {
            throw new Error('Editable text was not fully masked for screenshot capture');
          }
        }
        var elements = root.querySelectorAll('*');
        for (var e = 0; e < elements.length; e++) {
          var el = elements[e];
          var name = (el.localName || '').toLowerCase();
          if ((name.indexOf('-') !== -1 || el.hasAttribute('is')) &&
              doc.defaultView.customElements.get(el.getAttribute('is') || name) && !el.shadowRoot) {
            throw new Error('Closed custom-element shadow root prevents safe screenshot masking');
          }
          if (el.shadowRoot) visit(el.shadowRoot, doc);
        }
        var frames = root.querySelectorAll('iframe,frame');
        for (var i = 0; i < frames.length; i++) {
          var frame = frames[i];
          try {
            var child = frame.contentDocument;
            if (child) visit(child, child);
            else {
              frame.setAttribute(attr, token);
              if (doc.defaultView.getComputedStyle(frame).visibility !== 'hidden') {
                throw new Error('Inaccessible frame was not hidden for screenshot capture');
              }
            }
          } catch (_) {
            frame.setAttribute(attr, token);
            if (doc.defaultView.getComputedStyle(frame).visibility !== 'hidden') {
              throw new Error('Inaccessible frame was not hidden for screenshot capture');
            }
          }
        }
      }
      visit(document, document);
      return true;
    })()`,
      returnByValue: true,
      awaitPromise: false,
    })
  } catch (error) {
    await removeScreenshotFieldMask(session, token).catch(() => {})
    throw error
  }
  if (result.exceptionDetails || result.result?.value !== true) {
    await removeScreenshotFieldMask(session, token).catch(() => {})
    throw new Error('Unable to mask editable values for screenshot capture')
  }
}

function containsClosedShadowRoot(node: DomNode): boolean {
  if (node.shadowRootType === 'closed') return true
  const children = [
    ...(node.children ?? []),
    ...(node.shadowRoots ?? []),
    ...(node.pseudoElements ?? []),
    ...(node.contentDocument ? [node.contentDocument] : []),
    ...(node.templateContent ? [node.templateContent] : []),
    ...(node.importedDocument ? [node.importedDocument] : []),
  ]
  return children.some(containsClosedShadowRoot)
}

export async function removeScreenshotFieldMask(
  session: ProtocolApi,
  token: string,
): Promise<void> {
  const attr = JSON.stringify(MASK_ATTRIBUTE)
  const marker = JSON.stringify(token)
  const result = await session.Runtime.evaluate({
    expression: `(() => {
      var attr = ${attr};
      var token = ${marker};
      function visit(root, seen) {
        if (!root || seen.has(root)) return;
        seen.add(root);
        var styles = root.querySelectorAll('style[' + attr + ']');
        for (var i = styles.length - 1; i >= 0; i--) {
          if (styles[i].getAttribute(attr) === token) styles[i].remove();
        }
        var frames = root.querySelectorAll('iframe[' + attr + '],frame[' + attr + ']');
        for (var j = frames.length - 1; j >= 0; j--) {
          var frame = frames[j];
          if (frame.getAttribute(attr) !== token) continue;
          frame.removeAttribute(attr);
        }
        var elements = root.querySelectorAll('*');
        for (var e = 0; e < elements.length; e++) if (elements[e].shadowRoot) visit(elements[e].shadowRoot, seen);
        var accessible = root.querySelectorAll('iframe,frame');
        for (var k = 0; k < accessible.length; k++) {
          try { if (accessible[k].contentDocument) visit(accessible[k].contentDocument, seen); } catch (_) {}
        }
      }
      visit(document, new Set());
      return true;
    })()`,
    returnByValue: true,
    awaitPromise: false,
  })
  if (result.exceptionDetails || result.result?.value !== true) {
    throw new Error('Unable to restore page styles after screenshot capture')
  }
}
