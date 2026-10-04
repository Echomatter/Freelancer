import {
  agentTurnEntries,
  commandMessages,
  turnTools,
  turnWorking,
  chatAgentDetails,
} from "../domain/chat-tools.mjs";
import { useState } from "react";
import { buildRequestGroups } from "../domain/chat-view.mjs";
import { AgentTurnView } from "./AgentTurnView";
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
  toolbarData,
  messages,
  busy,
  dockRequest,
  isCurrentDock,
  dockIndex,
  setInspectedWork,
  setExpandedWork,
  session,
  openChild,
}: any) {
  const [agentScope, setAgentScope] = useState("turn");
  const details = turnTools(dockRequest, toolbarData.chat?.activity);
  const chatDetails = chatAgentDetails(buildRequestGroups(messages), toolbarData.chat?.activity);
  const turnAgentCount = agentTurnEntries(details).entries.length;
  const chatAgentCount = agentTurnEntries(chatDetails).entries.length;
  const commands = commandMessages(dockRequest?.responseMessages ?? [])
    .reverse()
    .map((message) => ({ ...message, parts: [...(message.parts ?? [])].reverse() }));
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
        agents: agentScope === "chat" ? chatAgentCount : turnAgentCount,
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
          <div className="agent-scope-options" role="group" aria-label="Agent scope">
            <button type="button" aria-pressed={agentScope === "turn"} onClick={() => setAgentScope("turn")}>This turn ({turnAgentCount})</button>
            <button type="button" aria-pressed={agentScope === "chat"} onClick={() => setAgentScope("chat")}>This chat ({chatAgentCount})</button>
          </div>
          <AgentTurnView details={agentScope === "chat" ? chatDetails : details} onChild={openChild} current={agentScope === "chat" || isCurrentDock} scope={agentScope} />
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
