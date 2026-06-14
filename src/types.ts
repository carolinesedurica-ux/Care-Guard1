export interface WorkplaceCase {
  id: string;
  title: string;
  description: string;
  redactedDescription: string;
  department: string;
  dateOfIncident: string;
  immediateSafetyConcern: 'yes' | 'no' | 'unknown';
  consentStatus: boolean;
  priorInterventions: string;
  policyCategory: string;
  status: 'draft' | 'triage_needed' | 'reviewing_agents' | 'under_review_challenge' | 'completed' | 'escalated_human';
  riskLevel: 'low' | 'moderate' | 'high' | 'critical' | null;
  bandRoomId: string;
  createdAt: string;
  updatedAt: string;
  
  // Shared state variables updated in the Band context
  urgentFlags: string[];
  missingInformation: string[];
  requiresHumanReview: boolean;
  
  // Final deliverables
  finalRecommendation: string | null;
  humanReviewerChecklist: string[];
  finalMemoCompiled?: FinalMemo;
}

export interface FinalMemo {
  finalRiskLevel: 'low' | 'moderate' | 'high' | 'critical';
  requiresHumanReview: boolean;
  recommendedNextStep: string;
  rationale: string[];
  humanReviewerChecklist: string[];
}

export type AgentRole = 
  | 'system' 
  | 'triage_agent' 
  | 'risk_agent' 
  | 'policy_compliance_agent' 
  | 'care_pathway_agent' 
  | 'review_decision_agent' 
  | 'hr_advisory'
  | 'human_reviewer';

export interface BandMessage {
  id: string;
  caseId: string;
  agent: AgentRole;
  agentName: string;
  agentAvatar?: string;
  content: string; // The primary reading text (can be markdown representation)
  structuredData?: any; // The JSON findings
  mentions?: string[];
  timestamp: string;
  type: 'system_log' | 'agent_report' | 'challenge_issued' | 'agent_reply' | 'final_memo' | 'human_action';
}
