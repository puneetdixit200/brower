import { type FC, lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router'
import { AsterCommandPalette } from '@/components/layout/AsterCommandPalette'
import { SettingsSidebarLayout } from '@/components/layout/SettingsSidebarLayout'
import { SidebarLayout } from '@/components/layout/SidebarLayout'
import { AgentCommandHome } from '@/screens/agent-command/AgentCommandHome'
import { NewTabLayout } from '@/screens/newtab/layout/NewTabLayout'

// Keep the main composer eager. Heavy secondary routes load only when visited.
// This reduces initial new-tab JavaScript parsing and avoids idle settings work.
const DiagnosticsPage = lazy(() =>
  import('@browseros/diagnostics/view').then((module) => ({
    default: module.DiagnosticsPage,
  })),
)

const AISettingsPage = lazy(() =>
  import('@/screens/ai-settings/AISettingsPage').then((module) => ({
    default: module.AISettingsPage,
  })),
)

const ConnectMCP = lazy(() =>
  import('@/screens/connect-mcp/ConnectMCP').then((module) => ({
    default: module.ConnectMCP,
  })),
)

const CustomizationPage = lazy(() =>
  import('@/screens/customization/CustomizationPage').then((module) => ({
    default: module.CustomizationPage,
  })),
)

const FeaturesPage = lazy(() =>
  import('@/screens/features/Features').then((module) => ({
    default: module.FeaturesPage,
  })),
)

const SurveyPage = lazy(() =>
  import('@/screens/jtbd-agent/SurveyPage').then((module) => ({
    default: module.SurveyPage,
  })),
)

const LlmHubPage = lazy(() =>
  import('@/screens/llm-hub/LlmHubPage').then((module) => ({
    default: module.LlmHubPage,
  })),
)

const MCPSettingsPage = lazy(() =>
  import('@/screens/mcp-settings/MCPSettingsPage').then((module) => ({
    default: module.MCPSettingsPage,
  })),
)

const MemoryPage = lazy(() =>
  import('@/screens/memory/MemoryPage').then((module) => ({
    default: module.MemoryPage,
  })),
)

const ActionPolicyPage = lazy(() =>
  import('@/screens/action-policy/ActionPolicyPage').then((module) => ({
    default: module.ActionPolicyPage,
  })),
)

const NewTabChat = lazy(() =>
  import('@/screens/newtab/index/NewTabChat').then((module) => ({
    default: module.NewTabChat,
  })),
)

const Personalize = lazy(() =>
  import('@/screens/newtab/personalize/Personalize').then((module) => ({
    default: module.Personalize,
  })),
)

const OnboardingAiPage = lazy(() =>
  import('@/screens/onboarding-ai/OnboardingAiPage').then((module) => ({
    default: module.OnboardingAiPage,
  })),
)

const PrivacySettingsPage = lazy(() =>
  import('@/screens/privacy/PrivacySettingsPage').then((module) => ({
    default: module.PrivacySettingsPage,
  })),
)

const ScheduledTasksPage = lazy(() =>
  import('@/screens/scheduled-tasks/ScheduledTasksPage').then((module) => ({
    default: module.ScheduledTasksPage,
  })),
)

const TaskHistoryPage = lazy(() =>
  import('@/screens/task-history/TaskHistoryPage').then((module) => ({
    default: module.TaskHistoryPage,
  })),
)

function getSurveyParams(): { maxTurns?: number; experimentId?: string } {
  const params = new URLSearchParams(window.location.search)
  const maxTurnsStr = params.get('maxTurns')
  const experimentId = params.get('experimentId') ?? 'default'
  const maxTurns = maxTurnsStr ? Number.parseInt(maxTurnsStr, 10) : 7
  return { maxTurns, experimentId }
}

const OptionsRedirect: FC = () => {
  const params = useParams()
  const path = params['*'] || ''

  const routeMap: Record<string, string> = {
    ai: '/settings/ai',
    chat: '/settings/chat',
    'connect-mcp': '/connect-apps',
    mcp: '/settings/mcp',
    customization: '/settings/customization',
    search: '/settings/ai',
    'jtbd-agent': '/settings/survey',
    scheduled: '/scheduled',
  }

  const newPath = routeMap[path] || '/settings/ai'
  return <Navigate to={newPath} replace />
}

export const App: FC = () => {
  const surveyParams = getSurveyParams()

  return (
    <HashRouter>
      <AsterCommandPalette />
      <Suspense
        fallback={
          <div
            role="status"
            className="px-6 py-8 text-muted-foreground text-sm"
          >
            Loading Aster page…
          </div>
        }
      >
        <Routes>
          <Route element={<SidebarLayout />}>
            <Route path="home" element={<NewTabLayout />}>
              <Route index element={<AgentCommandHome />} />
              <Route path="chat" element={<NewTabChat />} />
              <Route path="personalize" element={<Personalize />} />
            </Route>

            <Route path="connect-apps" element={<ConnectMCP />} />
            <Route path="scheduled" element={<ScheduledTasksPage />} />
            <Route path="tasks" element={<TaskHistoryPage />} />
            <Route path="tasks/:taskId" element={<TaskHistoryPage />} />
          </Route>

          <Route element={<SettingsSidebarLayout />}>
            <Route path="settings">
              <Route index element={<Navigate to="/settings/ai" replace />} />
              <Route path="ai" element={<AISettingsPage key="ai" />} />
              <Route path="chat" element={<LlmHubPage />} />
              <Route path="mcp" element={<MCPSettingsPage />} />
              <Route path="memory" element={<MemoryPage />} />
              <Route path="permissions" element={<ActionPolicyPage />} />
              <Route path="privacy" element={<PrivacySettingsPage />} />
              <Route path="customization" element={<CustomizationPage />} />
              <Route path="diagnostics" element={<DiagnosticsPage />} />
              <Route
                path="search"
                element={<Navigate to="/settings/ai" replace />}
              />
              <Route path="survey" element={<SurveyPage {...surveyParams} />} />
              <Route
                path="*"
                element={<Navigate to="/settings/ai" replace />}
              />
            </Route>
          </Route>

          <Route path="features" element={<FeaturesPage />} />

          {/* First-run setup, opened by the native onboarding on completion.
              Outside every layout route on purpose: no sidebar, no chrome. */}
          <Route path="onboarding">
            <Route path="ai" element={<OnboardingAiPage />} />
            <Route index element={<Navigate to="/onboarding/ai" replace />} />
          </Route>

          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route
            path="/personalize"
            element={<Navigate to="/home/personalize" replace />}
          />
          <Route
            path="/settings/connect-mcp"
            element={<Navigate to="/connect-apps" replace />}
          />
          <Route path="/audit" element={<Navigate to="/home" replace />} />
          <Route
            path="/observability"
            element={<Navigate to="/home" replace />}
          />
          <Route path="/executions" element={<Navigate to="/home" replace />} />
          <Route
            path="/agents"
            element={<Navigate to="/settings/ai" replace />}
          />
          <Route
            path="/agents/:agentId"
            element={<Navigate to="/settings/ai" replace />}
          />
          <Route path="/options/*" element={<OptionsRedirect />} />

          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}
