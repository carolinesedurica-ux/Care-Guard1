import { Shield, Sparkles, CheckCircle, Clock } from "lucide-react";
import { AgentRole } from "../types";

interface AgentStatusListProps {
  activeMessages: { agent: AgentRole }[];
  isReviewing: boolean;
  customAgentInfo?: { 
    id: string | null; 
    hasKey: boolean; 
    handle: string | null;
    agents?: {
      triage?: { id: string; handle: string; hasKey: boolean };
      risk?: { id: string; handle: string; hasKey: boolean };
      policy?: { id: string; handle: string; hasKey: boolean };
      coreNav?: { id: string; handle: string; hasKey: boolean };
      complianceDir?: { id: string; handle: string; hasKey: boolean };
      hrAdvisory?: { id: string; handle: string; hasKey: boolean };
    };
  } | null;
}

const AGENTS_ROSTER = [
  {
    role: "triage_agent" as AgentRole,
    name: "Triage Sentinel",
    avatar: "🎯",
    desc: "Redacts identifiers and logs core hazard categories"
  },
  {
    role: "risk_agent" as AgentRole,
    name: "Risk Analytics Engine",
    avatar: "⚠️",
    desc: "Flags legal retaliation, safety levels, and trauma exposure"
  },
  {
    role: "policy_compliance_agent" as AgentRole,
    name: "Policy Guard",
    avatar: "📜",
    desc: "Binds cases to statutory labor laws and privacy guidelines"
  },
  {
    role: "care_pathway_agent" as AgentRole,
    name: "Care Navigator",
    avatar: "🌱",
    desc: "Designs EAP, manager-decoupling, and safety adjustments"
  },
  {
    role: "review_decision_agent" as AgentRole,
    name: "Compliance Review Director",
    avatar: "⚖️",
    desc: "Peer audits recommendations via challenges & compiles final memo"
  },
  {
    role: "hr_advisory" as AgentRole,
    name: "HR Advisory",
    avatar: "👔",
    desc: "Proposes executing step-by-step resolution pathways and RACI matrix"
  }
];

export default function AgentStatusList({ activeMessages, isReviewing, customAgentInfo }: AgentStatusListProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-3xs">
      <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-slate-100">
        <Shield className="w-4 h-4 text-indigo-600" id="agent-shield-icon" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800" id="committee-header">Active Agent Taskforce</h3>
      </div>
      
      <div className="space-y-2">
        {AGENTS_ROSTER.map((agent) => {
          const hasContributed = activeMessages.some((m) => m.agent === agent.role);
          let statusText = "Ready";
          let statusColor = "text-slate-400 bg-slate-50 border-slate-200";
          let Icon = Clock;

          if (isReviewing && !hasContributed) {
            statusText = "Analyzing...";
            statusColor = "text-amber-700 bg-amber-50 border-amber-200/60 animate-pulse";
            Icon = Sparkles;
          } else if (hasContributed) {
            statusText = "Sealed";
            statusColor = "text-emerald-700 bg-emerald-50 border-emerald-250";
            Icon = CheckCircle;
          }

          // Resolve specific agent details
          let agentConfig: { id: string; handle: string; hasKey: boolean } | null = null;
          if (customAgentInfo?.agents) {
            if (agent.role === "triage_agent") agentConfig = customAgentInfo.agents.triage || null;
            else if (agent.role === "risk_agent") agentConfig = customAgentInfo.agents.risk || null;
            else if (agent.role === "policy_compliance_agent") agentConfig = customAgentInfo.agents.policy || null;
            else if (agent.role === "care_pathway_agent") agentConfig = customAgentInfo.agents.coreNav || null;
            else if (agent.role === "review_decision_agent") agentConfig = customAgentInfo.agents.complianceDir || null;
            else if (agent.role === "hr_advisory") agentConfig = customAgentInfo.agents.hrAdvisory || null;
          } else if (agent.role === "triage_agent" && customAgentInfo) {
            agentConfig = {
              id: customAgentInfo.id || "",
              handle: customAgentInfo.handle || "",
              hasKey: customAgentInfo.hasKey
            };
          }

          return (
            <div key={agent.role} className="flex items-start justify-between gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors border border-transparent">
              <div className="flex gap-2.5">
                <span className="text-xl shrink-0 leading-none mt-0.5">{agent.avatar}</span>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="text-xs font-bold text-slate-800">{agent.name}</h4>
                    {agentConfig?.handle && (
                      <span className="font-mono text-[8px] font-bold text-indigo-700 bg-indigo-50/80 border border-indigo-200 /60 border-indigo-200/65 px-1.5 py-0.5 rounded leading-none" title={`Active Custom Agent ID: ${agentConfig.id}`}>
                        {agentConfig.handle}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-450 leading-normal max-w-[140px] md:max-w-none">{agent.desc}</p>
                </div>
              </div>
              <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-wider shrink-0 uppercase border ${statusColor}`}>
                <Icon className="w-2.5 h-2.5 shrink-0" />
                {statusText}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
