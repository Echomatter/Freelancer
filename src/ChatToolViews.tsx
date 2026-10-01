import {
  agentTurnEntries,
  commandMessages,
  turnTools,
  turnWorking,
} from "../domain/chat-tools.mjs";
import { AgentTurnView } from "./AgentTurnView";
import { resolveTodoLayout } from "../domain/appearance.mjs";
import {
  summarizeRequestWork,
  requestWorkLabel,
} from "../domain/chat-view.mjs";
import { hasUnfinishedTodos, todoStatusLabel } from "../domain/todos.mjs";
import { ChatToolbar } from "./ChatToolbar";
import { GroupBody } from "./ChatMessages";
import { GoalOverview } from "./GoalOverview";
import { GoalHandoffs } from "./GoalHandoffs";
import { ProviderText } from "./ProviderColors";
import { ContributionRows } from "./Contributions";

export function ChatToolViews({
  attachmentContext,
  expandedWork,
  toolSelection,
  toolSection,
  turnEvents,
  dockSummary,
  toolbarData,
  messages,
  busy,
  dockRequest,
  isCurrentDock,
  dockIndex,
  setInspectedWork,
  setExpandedWork,
  data,
  todos,
  session,
  openChild,
}: any) {
  const details = turnTools(dockRequest, toolbarData.chat?.activity);
  const commands = commandMessages(dockRequest?.responseMessages ?? [])
    .reverse()
    .map((message) => ({ ...message, parts: [...(message.parts ?? [])].reverse() }));
  const commandSummary = summarizeRequestWork(commands, todos);
  const context = (
    <div className="chat-turn-context">
      <span>
        {isCurrentDock ? "Current turn" : "Reviewing turn " + (dockIndex + 1)}
      </span>
      {!isCurrentDock && (
        <button
          type="button"
          className="work-changes-link"
          onClick={() => {
            setInspectedWork(null);
            setExpandedWork(null);
          }}
        >
          Back to current turn
        </button>
      )}
    </div>
  );
  return (
    <ChatToolbar
      key={attachmentContext}
      selection={expandedWork ? expandedWork + ":" + toolSelection : null}
      selectedSection={toolSection}
      counts={{
        commands: details.commands.length,
        agents: agentTurnEntries(details).entries.length,
        models: details.models.length,
        goals: toolbarData.goal?.status,
      }}
      working={turnWorking(details, {
        current: isCurrentDock,
        busy: busy && (!toolbarData.chat?.status || toolbarData.chat.status[session?.id]?.type === "busy"),
        blocked: !!(
          toolbarData.chat?.permissions?.length ||
          toolbarData.chat?.questions?.length
        ),
        goalStatus: toolbarData.goal?.status,
      })}
      commands={
        <>
          {context}
          {dockSummary && (
            <p>{requestWorkLabel(commandSummary, isCurrentDock && busy)}</p>
          )}
          {resolveTodoLayout(data.settings.appearance) === "inline" && (
            <>
              {!busy && hasUnfinishedTodos(todos) && (
                <p>
                  Response ended with unfinished tasks. Send a follow-up to
                  continue.
                </p>
              )}
              {todos.map((todo, i) => (
                <div className="todo" key={i}>
                  <span>{todo.content}</span>
                  <small>{todoStatusLabel(todo, busy)}</small>
                </div>
              ))}
            </>
          )}
          {dockRequest && !details.commands.length && (
            <p>No tools recorded for this turn.</p>
          )}
          {dockRequest ? (
            <GroupBody
              group={{ messages: commands }}
              onChild={openChild}
              mode="work"
            />
          ) : (
            <p>No commands yet.</p>
          )}
        </>
      }
      agents={
        <>
          {session?.parentID && (
            <button
              type="button"
              className="work-changes-link"
              onClick={() => openChild(session.parentID)}
            >
              Back to parent chat
            </button>
          )}
          {context}
          <AgentTurnView details={details} onChild={openChild} current={isCurrentDock} />
        </>
      }
      models={
        <>
          <section className="model-work-overview" aria-label="Work by models">
            <h3>Work by models</h3>
            <p className="changes-scope">This chat and its agents · {toolbarData.contributions?.month ?? "this month"} · share of measured token activity</p>
            <ContributionRows breakdown={toolbarData.contributions?.models} />
            {toolbarData.contributions?.ancestryUncertain && <p className="notice">Some delegation links could not be resolved.</p>}
          </section>
          {context}
          {details.models.map((id) => (
            <p key={id}>
              <ProviderText provider={id} mark>
                {id}
              </ProviderText>
            </p>
          ))}
          <GoalHandoffs
            events={turnEvents.filter((event) => event.kind === "model")}
          />
          {!details.models.length && <p>No model activity recorded for this turn.</p>}
        </>
      }
      goal={
        toolbarData.goal && (
          <>
            <GoalOverview
              goal={toolbarData.goal}
              onManage={toolbarData.onManageGoal}
              onChange={toolbarData.onGoalChange}
            />
            {context}
            <GroupBody
              group={{ messages: details.goalMessages }}
              onChild={openChild}
            />
            <GoalHandoffs events={turnEvents} />
          </>
        )
      }
    />
  );
}
