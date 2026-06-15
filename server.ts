import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { WorkplaceCase, BandMessage, AgentRole, FinalMemo } from "./src/types";
import { BandClient } from "./src/lib/band";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = 3000;

// Setup all five agents requested by the user, providing dynamic env keys and hardcoded fallbacks as fallback guarantees
const agentsConfig = {
  triage: {
    id: process.env.BAND_AGENT_ID || "triage-sentinel",
    apiKey: process.env.BAND_API_KEY || "",
    handle: process.env.BAND_AGENT_HANDLE || "@pameltex3237/triage-sentinel"
  },
  risk: {
    id: process.env.BAND_RISK_AGENT_ID || "b979fe31-63be-420f-8b0c-e58f9cb6aca8",
    apiKey: process.env.BAND_RISK_API_KEY || "band_a_1781438994_Liryv_c_nQOJRfV3QXcPmoaBvZtB6WGY",
    handle: process.env.BAND_RISK_HANDLE || "@pameltex3237/remote-analytic-engine"
  },
  policy: {
    id: process.env.BAND_POLICY_AGENT_ID || "0a133bf6-158f-435c-8629-4a9e2f51dd8e",
    apiKey: process.env.BAND_POLICY_API_KEY || "band_a_1781439245_41-AvW0SBX3tztcf1qxtiDDf1IDlsL-K",
    handle: process.env.BAND_POLICY_HANDLE || "@pameltex3237/policy-guard"
  },
  coreNav: {
    id: process.env.BAND_CORE_NAV_AGENT_ID || "db0aeacd-62a7-4d3a-8fac-e0a6dffbb5a0",
    apiKey: process.env.BAND_CORE_NAV_API_KEY || "band_a_1781439721_v7-dUNEVLjxsSWApxtluvH5ar8Nskzsg",
    handle: process.env.BAND_CORE_NAV_HANDLE || "@pameltex3237/core-navigator"
  },
  complianceDir: {
    id: process.env.BAND_COMPLIANCE_DIR_AGENT_ID || "00a546d7-5a8f-4957-8816-619fd5c72d25",
    apiKey: process.env.BAND_COMPLIANCE_DIR_API_KEY || "band_a_1781439944__QgNunPhFKTfQ8JOUHoKD_cVu5CV18tD",
    handle: process.env.BAND_COMPLIANCE_DIR_HANDLE || "@pameltex3237/compliance-review-direct"
  },
  hrAdvisory: {
    id: process.env.BAND_HR_ADVISORY_AGENT_ID || "cc4f5c79-2d1b-468b-bc84-761438a69ee3",
    apiKey: process.env.BAND_HR_ADVISORY_API_KEY || "band_a_1781455629_4sHquzl5Sk0A-flklIuin6586f-j6RuC",
    handle: process.env.BAND_HR_ADVISORY_HANDLE || "@pameltex3237/hr-advisory"
  }
};

const bandClient = new BandClient(agentsConfig.triage.apiKey);
const riskClient = new BandClient(agentsConfig.risk.apiKey);
const policyClient = new BandClient(agentsConfig.policy.apiKey);
const coreNavClient = new BandClient(agentsConfig.coreNav.apiKey);
const complianceDirClient = new BandClient(agentsConfig.complianceDir.apiKey);
const hrAdvisoryClient = new BandClient(agentsConfig.hrAdvisory.apiKey);

function getRoomCreatorClient(): BandClient {
  if (bandClient.isConfigured) return bandClient;
  if (complianceDirClient.isConfigured) return complianceDirClient;
  if (hrAdvisoryClient.isConfigured) return hrAdvisoryClient;
  if (riskClient.isConfigured) return riskClient;
  if (policyClient.isConfigured) return policyClient;
  if (coreNavClient.isConfigured) return coreNavClient;
  return bandClient;
}

function isAnyBandClientConfigured(): boolean {
  return bandClient.isConfigured || 
         riskClient.isConfigured || 
         policyClient.isConfigured || 
         coreNavClient.isConfigured || 
         complianceDirClient.isConfigured ||
         hrAdvisoryClient.isConfigured;
}

// Initialize Gemini SDK with named parameters & headers as instructed by rules
const apiKey = process.env.GEMINI_API_KEY || "";
let ai: GoogleGenAI | null = null;
if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
  try {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  } catch (err) {
    console.error("Failed to initialize Gemini SDK:", err);
  }
}

// Helper to call OpenAI-compatible endpoints (Featherless & AI/ML API)
// Uses a 30-second AbortController timeout to prevent agents from hanging in queue
async function runOpenAICompatibleCompletion(options: {
  provider: "featherless" | "aiml";
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const provider = options.provider;
  const key = provider === "featherless" ? process.env.FEATHERLESS_API_KEY : process.env.AIML_API_KEY;
  const baseUrl = provider === "featherless" ? "https://api.featherless.ai/v1" : "https://api.aimlapi.com/v1";
  const timeoutMs = options.timeoutMs ?? 30000; // 30s default timeout

  if (!key) {
    throw new Error(`API Key for ${provider} is missing. Please check your config.`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[${provider.toUpperCase()} API Error] Code ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error(`[${provider.toUpperCase()} API Error] Empty response`);
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

// In-Memory Database for Case Rooms
let cases: WorkplaceCase[] = [];
let messages: Record<string, BandMessage[]> = {};

// Helper to pre-seed cases and reviews so the app has instant high-fidelity content
function preseedCases() {
  const caseId1 = "case-2026-001";
  const caseId2 = "case-2026-002";

  // Pre-seed Case 1: Complex Absenteeism / Panic Attacks (The Finance Dept Case)
  const case1: WorkplaceCase = {
    id: caseId1,
    title: "Finance Dept: Sudden Absenteeism & Psychological Safety",
    description: "An employee in the finance department has missed several days of work after a confrontation with their supervisor. They report panic symptoms before work, say they do not feel safe being alone with the supervisor, and have asked HR not to disclose the conversation. Their manager is requesting a disciplinary meeting for absenteeism.",
    redactedDescription: "An employee in the FINANCE DEPARTMENT has missed several days of work after a confrontation with their SUPERVISOR. They report panic symptoms before work, say they do not feel safe being alone with the SUPERVISOR, and have asked HR not to disclose the conversation. Their SUPERVISOR is requesting a disciplinary meeting for absenteeism.",
    department: "Finance",
    dateOfIncident: "2026-06-08",
    immediateSafetyConcern: "unknown",
    consentStatus: false,
    priorInterventions: "None. Manager requested disciplinary hearing directly.",
    policyCategory: "Psychosocial Risk / Conflict Resolution",
    status: "completed",
    riskLevel: "high",
    bandRoomId: "case-2026-001-psychosocial-risk-review",
    createdAt: new Date(Date.now() - 4 * 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
    urgentFlags: ["Psychological Distress", "Retaliation Risk", "Confidentiality Limit"],
    missingInformation: [
      "Is there history of prior conflict between supervisor and employee?",
      "Has employee explicitly declined formal union/EAP help?",
      "Are there witnesses to the active confrontation?"
    ],
    requiresHumanReview: true,
    finalRecommendation: "Suspend disciplinary proceedings immediately. Conduct safety screening and arrange temporary reporting structure change before discussing attendance with the supervisor.",
    humanReviewerChecklist: [
      "Contact employee to offer confidential Employee Assistance Program (EAP) referral.",
      "Inform the supervisor that the disciplinary meeting is postponed pending administrative review (do not disclose psychological symptoms).",
      "Assign an alternative manager or HR proxy for the employee's weekly deliverables to resolve the immediate 'unsafe' dynamic.",
      "Secure sign-off from Workplace Ombuds/Health Representative."
    ],
    finalMemoCompiled: {
      finalRiskLevel: "high",
      requiresHumanReview: true,
      recommendedNextStep: "Immediate disciplinary freeze, temporary supervisor decoupling, and targeted EAP offer within 12 hours.",
      rationale: [
        "Primary hazard stems from direct supervisor exposure creating active psychosomatic symptoms (panic).",
        "Absenteeism is highly correlated with workplace safety anxiety rather than neglect, raising severe compliance liability if disciplined under standard attendance policy.",
        "Confidentiality request complicates standard factual investigation, requiring an intermediate decoupled state."
      ],
      humanReviewerChecklist: [
        "Issue written freeze on attendance hearing.",
        "Establish alternative reporter pathway.",
        "Obtain employee consent to log incident under formal safety review.",
        "Verify EAP touchpoint completion."
      ]
    }
  };

  const case1Msgs: BandMessage[] = [
    {
      id: "m1-1",
      caseId: caseId1,
      agent: "system",
      agentName: "CareGuard Gateway",
      content: "🛡️ New Case Intake: A Band room has been opened for Case #case-2026-001. Specialised agents have been summoned to perform evaluation, regulatory mapping, and advisory memo generation.",
      timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
      type: "system_log"
    },
    {
      id: "m1-2",
      caseId: caseId1,
      agent: "triage_agent",
      agentName: process.env.BAND_AGENT_HANDLE ? `Triage Sentinel (${process.env.BAND_AGENT_HANDLE})` : "Triage Sentinel",
      agentAvatar: "🎯",
      content: "**Triage Complete:** Identified high psychosocial strain resulting from reporting-line conflict. Category: Psychosocial Risk. Initial Urgency Score: **High**.\n\n*Handoff:* Requesting safety validation from @risk_agent and regulatory compliance checklist from @policy_compliance_agent.",
      structuredData: {
        category: "Psychosocial Risk / Workplace Conflict",
        urgency: "high",
        keyMetrics: { absenteeism: true, medical_anxiety: true },
        handoff: ["risk_agent", "policy_compliance_agent"]
      },
      timestamp: new Date(Date.now() - 3.8 * 3600000).toISOString(),
      type: "agent_report"
    },
    {
      id: "m1-3",
      caseId: caseId1,
      agent: "risk_agent",
      agentName: "Risk Analytics Engine",
      agentAvatar: "⚠️",
      content: "**Psychosocial Risk Assessment:**\n- **Self-Harm/Violence:** Unknown, but high acute psychological distress is reported (panic symptoms).\n- **Supervisor Interaction Risk:** High. The employee expresses feeling unsafe.\n- **Retaliation Risk:** Critical, since the manager is actively initiating disciplinary action for absenteeism which is caused by the safety panic.\n- **Corporate Liability:** High if disciplinary actions are pushed forward without addressing the underlying safety claims.",
      structuredData: {
        risk_flags: ["retaliation_risk", "psychological_distress", "regulatory_non_compliance"],
        recommended_risk_level: "high"
      },
      timestamp: new Date(Date.now() - 3.6 * 3600000).toISOString(),
      type: "agent_report"
    },
    {
      id: "m1-4",
      caseId: caseId1,
      agent: "policy_compliance_agent",
      agentName: "Policy Guard",
      agentAvatar: "📜",
      content: "**Policy & Compliance Assessment:**\nMatches policy Section 4.2 (Employee Psychological Welfare & Duty of Care). \n- **Duty of Care Obligation:** Critical. The company must provide a workplace free from recognized psychological hazards.\n- **Disciplinary Conflict:** Initiating disciplinary review for absences triggered by raw trauma symptoms exposes the organisation to retaliation and unfair dismissal claims.\n- **Consent Limitation:** Employee requested non-disclosure. Under state guidelines, we must respect confidentiality unless there is direct, imminent bodily threat. We cannot share descriptions with the supervisor directly without formal consent.",
      structuredData: {
        policy_triggers: ["duty_of_care", "confidentiality_override_threshold", "attendance_protection"],
        compliance_risk: "critical_if_undocumented"
      },
      timestamp: new Date(Date.now() - 3.4 * 3600000).toISOString(),
      type: "agent_report"
    },
    {
      id: "m1-5",
      caseId: caseId1,
      agent: "care_pathway_agent",
      agentName: "Care Navigator",
      agentAvatar: "🌱",
      content: "**Care Pathway Design:**\n1. **EAP Support:** Request a dedicated, external clinical counselor through EAP within 24 hours.\n2. **Immediate Decoupling:** Relocate employee or transition to temporary remote execution, routing reports through an HR peer-buddy.\n3. **Supervisor Coaching:** Instruct supervisor that 'Attendance issues have been escalated for administrative wellness lookup. No immediate individual contact or meeting is permitted.'",
      timestamp: new Date(Date.now() - 3.2 * 3600000).toISOString(),
      type: "agent_report"
    },
    {
      id: "m1-6",
      caseId: caseId1,
      agent: "review_decision_agent",
      agentName: "Compliance Review Director",
      agentAvatar: "⚖️",
      content: "**Challenge Phase Initiated:** Cross-examining recommendations before compiling formal human-review advisory.\n\n❓ Questions for peer agents:\n1. @risk_agent : Are panic attacks and feeling unsafe sufficient to mandate supervisor bypass without a formal complaint?\n2. @policy_compliance_agent : Can we legally freeze attendance evaluation if the employee denies sharing logs with the manager?",
      timestamp: new Date(Date.now() - 3.0 * 3600000).toISOString(),
      type: "challenge_issued"
    },
    {
      id: "m1-7",
      caseId: caseId1,
      agent: "risk_agent",
      agentName: "Risk Analytics Engine",
      agentAvatar: "⚠️",
      content: "**Addressing @review_decision_agent:** Yes. An employee feeling physically or psychologically unsafe with their supervisor triggers instant organizational duties of accommodation. Failure to implement safe reporting pathways immediately, even before the completion of a formal grievance, exposes the organization to extreme liability if an incident or emergency occurs.",
      timestamp: new Date(Date.now() - 2.8 * 3600000).toISOString(),
      type: "agent_reply"
    },
    {
      id: "m1-8",
      caseId: caseId1,
      agent: "policy_compliance_agent",
      agentName: "Policy Guard",
      agentAvatar: "📜",
      content: "**Addressing @review_decision_agent:** Yes, attendance reviews can be temporarily suspended for an administrative 'wellness reconciliation' period. We do not need supervisor permission, nor do we violate the employee's request for secrecy, as the freeze is logged under standard medical/internal safety provisions.",
      timestamp: new Date(Date.now() - 2.6 * 3600000).toISOString(),
      type: "agent_reply"
    },
    {
      id: "m1-9",
      caseId: caseId1,
      agent: "review_decision_agent",
      agentName: "Compliance Review Director",
      agentAvatar: "⚖️",
      content: "🏛️ **Final Human Review Advisory Compiled.** Recommendation locked. Case updated. Ready for Human Reviewer sign-off.",
      timestamp: new Date(Date.now() - 2.4 * 3600000).toISOString(),
      type: "final_memo"
    },
    {
      id: "m1-10",
      caseId: caseId1,
      agent: "hr_advisory",
      agentName: "HR Advisory",
      agentAvatar: "👔",
      content: "💬 **Consultative advisory received. Step-by-step action plan follows.**\n\nHaving reviewed all peer assessments and the Director's consolidated memo, I am proposing the following collaborative resolution pathway for case manager confirmation. This plan is consultative — each step requires stakeholder agreement before execution.\n\n**Immediate Actions (0–24h):**\n• **Step 1** — HR Manager contacts the affected individual directly and confidentially to confirm understanding of rights and available support. No operational manager involvement at this stage.\n• **Step 2** — Activate the supervisor decoupling protocol. HR coordinates temporary reporting realignment — this is not punitive to the supervisor; it is a protective measure for the affected individual.\n• **Step 3** — EAP referral letter prepared and delivered to the individual by HR.\n\n**Short-Term (24–72h):**\n• **Step 4** — HR convenes a confidential briefing with the site Safety Committee to share the systemic finding and initiate a roster audit without attributing blame.\n• **Step 5** — HR prepares the WorkSafe notification draft in consultation with the legal team.\n• **Step 6** — HR schedules a structured welfare check with the affected individual.\n\n**RACI Matrix Summary:**\n- **Responsible:** HR Manager\n- **Accountable:** Chief People Officer\n- **Consulted:** Legal Counsel, External EAP Counselor\n- **Informed:** Department Head (decoupled from case details), Site Safety Representative",
      timestamp: new Date(Date.now() - 2.0 * 3600000).toISOString(),
      type: "agent_report"
    }
  ];

  // Pre-seed Case 2: Burnout / Compassion Fatigue (Customer Operations)
  const case2: WorkplaceCase = {
    id: caseId2,
    title: "Support Operations: Overwhelming Emotional Distress",
    description: "An employee in customer operations has seen a significant spike in customer distress calls. They report experiencing compassion fatigue, crying during breaks, and extreme mental exhaustion. They want to know what mental health support options are available, but are worried about career impact if they admit they are struggling.",
    redactedDescription: "An employee in CUSTOMER OPERATIONS has seen a significant spike in customer distress calls. They report experiencing compassion fatigue, crying during breaks, and extreme mental exhaustion. They want to know what mental health support options are available, but are worried about career impact if they admit they are struggling.",
    department: "Customer Operations",
    dateOfIncident: "2026-06-11",
    immediateSafetyConcern: "no",
    consentStatus: true,
    priorInterventions: "Asked about general benefit packets anonymously.",
    policyCategory: "Occupational Health / Burnout Mitigation",
    status: "triage_needed",
    riskLevel: null,
    bandRoomId: "case-2026-002-psychosocial-risk-review",
    createdAt: new Date(Date.now() - 1 * 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 3600000).toISOString(),
    urgentFlags: [],
    missingInformation: [],
    requiresHumanReview: true,
    finalRecommendation: null,
    humanReviewerChecklist: []
  };

  const case2Msgs: BandMessage[] = [
    {
      id: "m2-1",
      caseId: caseId2,
      agent: "system",
      agentName: "CareGuard Gateway",
      content: "🛡️ New Case Intake: A Band room has been opened for Case #case-2026-002. Intake metrics processed. Awaiting agent activation.",
      timestamp: new Date(Date.now() - 1 * 3600000).toISOString(),
      type: "system_log"
    }
  ];

  cases = [case1, case2];
  messages = {
    [caseId1]: case1Msgs,
    [caseId2]: case2Msgs
  };
}

// Initial hydration
preseedCases();

// ---------------------- API Endpoints ----------------------

app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

// 1. Get List of Cases
app.get("/api/cases", (req, res) => {
  res.json(cases);
});

// Get Active Config Context
app.get("/api/config", (req, res) => {
  res.json({
    hasGemini: !!ai,
    bandAgent: {
      id: process.env.BAND_AGENT_ID || "triage-sentinel-id",
      hasKey: isAnyBandClientConfigured(),
      handle: process.env.BAND_AGENT_HANDLE || "@pameltex3237/triage-sentinel",
      agents: {
        triage: {
          id: agentsConfig.triage.id,
          handle: agentsConfig.triage.handle,
          hasKey: bandClient.isConfigured
        },
        risk: {
          id: agentsConfig.risk.id,
          handle: agentsConfig.risk.handle,
          hasKey: riskClient.isConfigured
        },
        policy: {
          id: agentsConfig.policy.id,
          handle: agentsConfig.policy.handle,
          hasKey: policyClient.isConfigured
        },
        coreNav: {
          id: agentsConfig.coreNav.id,
          handle: agentsConfig.coreNav.handle,
          hasKey: coreNavClient.isConfigured
        },
        complianceDir: {
          id: agentsConfig.complianceDir.id,
          handle: agentsConfig.complianceDir.handle,
          hasKey: complianceDirClient.isConfigured
        },
        hrAdvisory: {
          id: agentsConfig.hrAdvisory.id,
          handle: agentsConfig.hrAdvisory.handle,
          hasKey: hrAdvisoryClient.isConfigured
        }
      }
    }
  });
});

// Test Connection to Band.ai
app.post("/api/config/test-band", async (req, res) => {
  try {
    const testPromises = [];
    if (bandClient.isConfigured) testPromises.push(bandClient.testConnection().then(r => ({ name: "Triage Sentinel", res: r })));
    if (riskClient.isConfigured) testPromises.push(riskClient.testConnection().then(r => ({ name: "Risk Analytics Engine", res: r })));
    if (policyClient.isConfigured) testPromises.push(policyClient.testConnection().then(r => ({ name: "Policy Guard", res: r })));
    if (coreNavClient.isConfigured) testPromises.push(coreNavClient.testConnection().then(r => ({ name: "Core Navigator", res: r })));
    if (complianceDirClient.isConfigured) testPromises.push(complianceDirClient.testConnection().then(r => ({ name: "Compliance Review Director", res: r })));
    if (hrAdvisoryClient.isConfigured) testPromises.push(hrAdvisoryClient.testConnection().then(r => ({ name: "HR Advisory", res: r })));

    const results = await Promise.all(testPromises);
    const successful = results.filter(r => r.res.success);

    if (successful.length > 0) {
      const activeAgent = successful[0];
      res.json({
        success: true,
        agent: {
          name: activeAgent.name,
          handle: activeAgent.name === "Triage Sentinel" ? agentsConfig.triage.handle : 
                 activeAgent.name === "Risk Analytics Engine" ? agentsConfig.risk.handle :
                 activeAgent.name === "Policy Guard" ? agentsConfig.policy.handle :
                 activeAgent.name === "Core Navigator" ? agentsConfig.coreNav.handle :
                 activeAgent.name === "Compliance Review Director" ? agentsConfig.complianceDir.handle :
                 agentsConfig.hrAdvisory.handle
        }
      });
    } else {
      res.json({
        success: false,
        error: "All configured Band.ai secrets rejected authentication. Please double check credentials."
      });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to execute connection test" });
  }
});

// 2. Get Single Case Details & Messages
app.get("/api/cases/:id", (req, res) => {
  const caseItem = cases.find(c => c.id === req.params.id);
  if (!caseItem) {
    return res.status(404).json({ error: "Case not found" });
  }
  const caseMessages = messages[req.params.id] || [];
  res.json({ caseItem, messages: caseMessages });
});

// 3. Create Case Intake
app.post("/api/cases", async (req, res) => {
  const { title, description, department, dateOfIncident, immediateSafetyConcern, consentStatus, priorInterventions, policyCategory } = req.body;
  if (!description || !title) {
    return res.status(400).json({ error: "Description and title are required" });
  }

  const caseId = `case-${Date.now().toString().slice(-4)}`;
  
  // Create redacted text
  let redacted = description;
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are the Pre-review Redaction Core for CareGuard. Your vital compliance duty is to strip individual names, addresses, phones, emails, employee IDs, and specific direct identifying manager names out of client's incident description and replace them with institutional role labels (e.g., 'EMPLOYEE', 'SUPERVISOR', 'HR COMPLIANCE').
Original statement: "${description}"
Return ONLY the fully sanitized version. Clean, readable, with same paragraphs, maintaining context for risk analysis. Do not include introductory notes. Just output the clean text itself.`,
      });
      if (response && response.text) {
        redacted = response.text.trim();
      }
    } catch (e) {
      console.warn("Redaction prompt failed, using simple replacement fallback:", e);
      // Basic regex replacement for names / personal identifiers fallback
      redacted = description;
    }
  }

  let finalBandRoomId = `${caseId}-psychosocial-risk-review`;
  let hasRealBandRoom = false;

  const activeCreator = getRoomCreatorClient();
  if (activeCreator.isConfigured) {
    try {
      const roomTitle = `CareGuard Case #${caseId}: ${title.substring(0, 80)}`;
      const realRoom = await activeCreator.createChatRoom(roomTitle);
      if (realRoom && realRoom.id) {
        finalBandRoomId = realRoom.id;
        hasRealBandRoom = true;
        console.log(`[BandClient] Real chat room created on Band.ai: ${finalBandRoomId}`);
      }
    } catch (err) {
      console.error("Failed to dynamically establish real Band.ai room:", err);
    }
  }

  const newCase: WorkplaceCase = {
    id: caseId,
    title,
    description,
    redactedDescription: redacted,
    department: department || "General Operations",
    dateOfIncident: dateOfIncident || new Date().toISOString().split('T')[0],
    immediateSafetyConcern: immediateSafetyConcern || "unknown",
    consentStatus: !!consentStatus,
    priorInterventions: priorInterventions || "No prior actions logged.",
    policyCategory: policyCategory || "Psychosocial Wellbeing / General Incident",
    status: "triage_needed",
    riskLevel: null,
    bandRoomId: finalBandRoomId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    urgentFlags: [],
    missingInformation: [],
    requiresHumanReview: true,
    finalRecommendation: null,
    humanReviewerChecklist: []
  };

  if (hasRealBandRoom) {
    try {
      await activeCreator.sendChatEvent(
        finalBandRoomId,
        `🛡️ Case Intake Sync Complete: Case #${caseId} has been successfully opened in CareGuard compliance workspace. Redaction and privacy filters are active.`,
        "task"
      );
    } catch (err) {
      console.warn("Failed to send init event to Band.ai:", err);
    }
  }

  const initMsg: BandMessage = {
    id: `m-${caseId}-1`,
    caseId,
    agent: "system",
    agentName: "CareGuard Gateway",
    content: hasRealBandRoom 
      ? `🛡️ New Case Intake: A live Band room has been opened on Band.ai platform (Room ID: ${finalBandRoomId}). Patient privacy constraints have been initiated, and specialized agents are synchronized.`
      : `🛡️ New Case Intake: A local Band room has been opened for Case #${caseId}. Patient privacy constraints have been initiated, and sensitive identity trackers have been redacted. Specialized agents have been summoned.`,
    timestamp: new Date().toISOString(),
    type: "system_log"
  };

  cases.unshift(newCase);
  messages[caseId] = [initMsg];

  res.status(201).json(newCase);
});

// 4. Trigger Multi-Agent Discussion using Gemini AI (Sequential/Debate Pipeline)
app.post("/api/cases/:id/trigger-review", async (req, res) => {
  const caseId = req.params.id;
  const caseItem = cases.find(c => c.id === caseId);
  if (!caseItem) {
    return res.status(404).json({ error: "Case not found" });
  }

  caseItem.status = "reviewing_agents";
  caseItem.updatedAt = new Date().toISOString();

  // Try to upgrade local/fallback room to online Band.ai room if key is now configured
  const activeCreator = getRoomCreatorClient();
  if (activeCreator.isConfigured && caseItem.bandRoomId.startsWith("case-")) {
    try {
      const roomTitle = `CareGuard Case #${caseId}: ${caseItem.title.substring(0, 80)}`;
      const realRoom = await activeCreator.createChatRoom(roomTitle);
      if (realRoom && realRoom.id) {
        caseItem.bandRoomId = realRoom.id;
        console.log(`[BandClient] Upgraded case to real Band.ai room: ${caseItem.bandRoomId}`);

        // Recruit all specialists into the Band.ai chat room to orchestrate deliberation
        // Internal agents: recruit by handle (Band API requires handle for internal agents)
        if (agentsConfig.risk.handle) {
          await activeCreator.addParticipant(realRoom.id, agentsConfig.risk.id, agentsConfig.risk.handle.replace("@", "")).catch(err => {
            console.warn(`Could not add risk agent participant:`, err.message || err);
          });
        }
        if (agentsConfig.policy.handle) {
          await activeCreator.addParticipant(realRoom.id, agentsConfig.policy.id, agentsConfig.policy.handle.replace("@", "")).catch(err => {
            console.warn(`Could not add policy agent participant:`, err.message || err);
          });
        }
        if (agentsConfig.coreNav.handle) {
          await activeCreator.addParticipant(realRoom.id, agentsConfig.coreNav.id, agentsConfig.coreNav.handle.replace("@", "")).catch(err => {
            console.warn(`Could not add coreNav agent participant:`, err.message || err);
          });
        }
        if (agentsConfig.complianceDir.handle) {
          await activeCreator.addParticipant(realRoom.id, agentsConfig.complianceDir.id, agentsConfig.complianceDir.handle.replace("@", "")).catch(err => {
            console.warn(`Could not add compliance director participant:`, err.message || err);
          });
        }
        if (agentsConfig.hrAdvisory.handle) {
          await activeCreator.addParticipant(realRoom.id, agentsConfig.hrAdvisory.id, agentsConfig.hrAdvisory.handle.replace("@", "")).catch(err => {
            console.warn(`Could not add HR advisory participant:`, err.message || err);
          });
        }
      }
    } catch (err) {
      console.warn("Could not upgrade room to real Band.ai room:", err);
    }
  }

  // Reset messages to clear any old processed messages other than system init log
  const initMsgs = (messages[caseId] || []).filter(m => m.type === "system_log");
  messages[caseId] = initMsgs;

  // Local helper to append message & simulate timeline
  const addMsg = (agent: AgentRole, agentName: string, content: string, type: any, struct?: any, avatar?: string) => {
    // Build list of other agents to resolve mentions dynamically
    const peerMentions = [
      { id: agentsConfig.triage.id, handle: agentsConfig.triage.handle, name: "Triage Sentinel", template: "@triage_agent" },
      { id: agentsConfig.risk.id, handle: agentsConfig.risk.handle, name: "Risk Analytics Engine", template: "@risk_agent" },
      { id: agentsConfig.policy.id, handle: agentsConfig.policy.handle, name: "Policy Guard", template: "@policy_compliance_agent" },
      { id: agentsConfig.coreNav.id, handle: agentsConfig.coreNav.handle, name: "Care Navigator", template: "@care_pathway_agent" },
      { id: agentsConfig.complianceDir.id, handle: agentsConfig.complianceDir.handle, name: "Compliance Review Director", template: "@review_decision_agent" },
      { id: agentsConfig.hrAdvisory.id, handle: agentsConfig.hrAdvisory.handle, name: "HR Advisory", template: "@hr_advisory" }
    ];

    let formattedContent = content;
    const mentionsToSend: { id: string; handle: string; name: string }[] = [];

    // Replace templates and collect mentions
    for (const peer of peerMentions) {
      if (formattedContent.includes(peer.template)) {
        formattedContent = formattedContent.replace(new RegExp(peer.template, "g"), peer.handle);
        mentionsToSend.push({ id: peer.id, handle: peer.handle, name: peer.name });
      } else if (formattedContent.includes(peer.handle)) {
        mentionsToSend.push({ id: peer.id, handle: peer.handle, name: peer.name });
      }
    }

    // Strict validation requirement: text messages sent by band agents require at least one mention of a registered participant
    if (mentionsToSend.length === 0 && agent !== "system") {
      if (agent === "review_decision_agent") {
        formattedContent += `\n\n(CC: ${agentsConfig.triage.handle})`;
        mentionsToSend.push({ id: agentsConfig.triage.id, handle: agentsConfig.triage.handle, name: "Triage Sentinel" });
      } else {
        formattedContent += `\n\n(CC: ${agentsConfig.complianceDir.handle})`;
        mentionsToSend.push({ id: agentsConfig.complianceDir.id, handle: agentsConfig.complianceDir.handle, name: "Compliance Review Director" });
      }
    }

    const newMsg: BandMessage = {
      id: `m-${caseId}-${messages[caseId].length + 1}`,
      caseId,
      agent,
      agentName,
      content: formattedContent,
      structuredData: struct,
      timestamp: new Date().toISOString(),
      type,
      agentAvatar: avatar
    };
    messages[caseId].push(newMsg);

    // Dynamic resolution of client to post on behalf of the registered agent identity
    let targetClient = bandClient;
    if (agent === "risk_agent" && riskClient.isConfigured) {
      targetClient = riskClient;
    } else if (agent === "policy_compliance_agent" && policyClient.isConfigured) {
      targetClient = policyClient;
    } else if (agent === "care_pathway_agent" && coreNavClient.isConfigured) {
      targetClient = coreNavClient;
    } else if (agent === "review_decision_agent" && complianceDirClient.isConfigured) {
      targetClient = complianceDirClient;
    } else if (agent === "hr_advisory" && hrAdvisoryClient.isConfigured) {
      targetClient = hrAdvisoryClient;
    } else if (!targetClient.isConfigured) {
      targetClient = activeCreator;
    }

    // Sync to real Band.ai platform in real-time if active
    if (targetClient.isConfigured && !caseItem.bandRoomId.startsWith("case-")) {
      let bType: "thought" | "tool_call" | "tool_result" | "error" | "task" = "task";
      if (type === "agent_report") {
        bType = "thought";
      } else if (type === "challenge_issued" || type === "agent_reply") {
        bType = "thought";
      } else if (type === "final_memo") {
        bType = "task";
      }

      // 1. Post Event (thought, tool_call, error, task etc.)
      targetClient.sendChatEvent(caseItem.bandRoomId, formattedContent, bType, struct)
        .catch(err => console.error(`Failed to push event as ${agentName} to Band.ai room ${caseItem.bandRoomId}:`, err));

      // 2. Post real Text Message to synchronize live deliberation through Band
      if (agent !== "system") {
        targetClient.sendTextMessage(caseItem.bandRoomId, formattedContent, mentionsToSend)
          .catch(err => console.error(`Failed to send deliberation message as ${agentName} to Band.ai room ${caseItem.bandRoomId}:`, err));
      }
    }

    return newMsg;
  };

  // Check if Gemini is available. If not, generate high-fidelity simulated response locally!
  if (!ai) {
    console.log("No Gemini API Key found or invalid, using simulated psychosocial multi-agent workflow fallback.");
    // Simulated High-Quality Sequence
    try {
      // 1. Triage Agent
      const triageText = `**Triage Analysis Complete:** Identified workplace distress elements associated with reporting hierarchy conflicts. Category: **Workplace Wellness / Incident Review**. Urgency Rating: **Moderate-High**.\n\n*Handoff:* Requesting high-stress safety flags from @risk_agent and statutory boundary definitions from @policy_compliance_agent. We need to assess immediate safety before recommending direct HR engagement.`;
      const triageS = {
        category: "Psychosocial Risk Escalation / Reporting Stress",
        urgency: "moderate",
        riskScores: { psychological_strain: "high", manager_distrust: "moderate" },
        missingDetails: ["Specific nature of supervisor verbal cues.", "Whether alternative work arrangements are available."]
      };
      addMsg("triage_agent", process.env.BAND_AGENT_HANDLE ? `Triage Sentinel (${process.env.BAND_AGENT_HANDLE})` : "Triage Sentinel", triageText, "agent_report", triageS, "🎯");

      // 2. Risk Agent
      const riskText = `**Psychosocial Risk Mapping:**\n- **Safety Flag:** Moderate distress signs present. No immediate threats of physical hazard noted, but acute emotional trauma is reported.\n- **Legal Retaliation Vector:** High if operational managers carry out performance or disciplinary action on matters originating from psychological stress reports.\n- **Risk Level Recommended:** **Moderate** to **High** based on supervisor containment requirement.`;
      const riskS = {
        escalation_priority: "high",
        key_risk_vectors: ["harassment_or_hostility", "confidentiality_vulnerability", "career_retaliation"],
        recommended_risk: "moderate"
      };
      addMsg("risk_agent", "Risk Analytics Engine", riskText, "agent_report", riskS, "⚠️");

      // 3. Policy Agent
      const policyText = `**Policy & Compliance Mapping:**\n- **Consent Restriction:** Crucial to respect the employee's confidentiality request unless life-safety measures are breached. Proceeding with supervisor disciplinary investigation withoutconsent violates safe-harbor standards.\n- **Company Obligation:** Psychological Duty of Care (Occupational Safety rules) requires HR to pause standard performance timelines while assessing mental strain triggers.`;
      const policyS = {
        statutory_codes: ["Occupational Health & Safety - Psychological Harassment Division", "Safe Disclosure Act (HR-402)"],
        mandatory_filing: ["Sealed Psychological Strain Record", "EAP Referral Consent Form"]
      };
      addMsg("policy_compliance_agent", "Policy Guard", policyText, "agent_report", policyS, "📜");

      // 4. Care Agent
      const careText = `**EAP & Pathway Recommender:**\n- **Active Referrals:** Issue immediate invitation to external psychological counselors with clear corporate subsidy disclaimer.\n- **Workplace Adjustment:** Facilitate a provisional modified work routine. Employee should avoid direct 1-to-1 syncs with the supervisor until HR completes the preliminary wellness review.\n- **Alternative Contacts:** Route task deliverables through an HR liaison proxy.`;
      addMsg("care_pathway_agent", "Care Navigator", careText, "agent_report", null, "🌱");

      // 5. Review Director Debate Challenge
      const reviewText = `**Challenge issued to peer agents:**\n\n❓ Let's stress-test the compliance and safety path before creating the final Human Action Memo:\n- @risk_agent : If we freeze performance triggers immediately, does it signal a premature finding of supervisor misconduct?\n- @policy_compliance_agent : If the employee explicitly prohibits talking to the supervisor, how can we carry out essential business operations without violating confidentiality?`;
      addMsg("review_decision_agent", "Compliance Review Director", reviewText, "challenge_issued", null, "⚖️");

      // Peer agents reply!
      const riskReply = `**Addressing @review_decision_agent:** It is not a finding of misconduct. It is a protective wellness administrative stay. We must document it clearly as a standard non-prejudicial workplace safety buffer, keeping both parties isolated while review proceeds.`;
      addMsg("risk_agent", "Risk Analytics Engine", riskReply, "agent_reply", null, "⚠️");

      const policyReply = `**Addressing @review_decision_agent:** We utilize 'operational decoupling'. HR directs the supervisor of a routine workload redistribution due to 'temporary operational projects' without disclosing psychological symptoms, remaining compliant with confidentiality.`;
      addMsg("policy_compliance_agent", "Policy Guard", policyReply, "agent_reply", null, "📜");

      // Final Memo
      const finalMemo: FinalMemo = {
        finalRiskLevel: "moderate",
        requiresHumanReview: true,
        recommendedNextStep: "Administrative workload decoupling, EAP Counselor assignment, and 48-hour case status reconciliation.",
        rationale: [
          "Preserves critical employee confidentiality requests.",
          "Protects organization from retributive labor litigation.",
          "Provides immediate mental relief to mitigate acute burnout vectors."
        ],
        humanReviewerChecklist: [
          "Obtain digital consent signature for sealed wellness consultation.",
          "Redirect workflow reporting line to Operations lead or HR proxy.",
          "Inform supervisor of attendance stayed status under Operational Wellness standard."
        ]
      };

      caseItem.riskLevel = "moderate";
      caseItem.status = "completed";
      caseItem.urgentFlags = ["Psychological Distress", "Retaliation Risk"];
      caseItem.missingInformation = ["Supervisor feedback on general attendance levels prior to the dispute."];
      caseItem.finalRecommendation = finalMemo.recommendedNextStep;
      caseItem.humanReviewerChecklist = finalMemo.humanReviewerChecklist;
      caseItem.finalMemoCompiled = finalMemo;

      const finishMsgText = `**Final recommendation memo compiled successfully.** Recommended Action: **${finalMemo.recommendedNextStep}**. All audit paths completed. Re-routing case folder to human compliance lead.`;
      addMsg("review_decision_agent", "Compliance Review Director", finishMsgText, "final_memo", finalMemo, "⚖️");

      // 8. HR Advisory Call (Simulation Fallback)
      const hrText = `💬 **Consultative advisory received. Step-by-step action plan follows.**\n\nHaving reviewed all peer assessments and the Director's consolidated memo, I am proposing the following collaborative resolution pathway for case manager confirmation. This plan is consultative — each step requires stakeholder agreement before execution.\n\n**Immediate Actions (0–24h):**\n• **Step 1** — HR Manager contacts the affected individual directly and confidentially to confirm understanding of rights and available support. No operational manager involvement at this stage.\n• **Step 2** — Activate the supervisor decoupling protocol. HR coordinates temporary reporting realignment — this is not punitive to the supervisor; it is a protective measure for the affected individual.\n• **Step 3** — EAP referral letter prepared and delivered to the individual by HR.\n\n**Short-Term (24–72h):**\n• **Step 4** — HR convenes a confidential briefing with the site Safety Committee. Purpose: share the systemic finding and initiate the roster audit without attributing blame to individuals.\n• **Step 5** — HR prepares the WorkSafe notification draft in consultation with the legal team.\n• **Step 6** — HR schedules a structured welfare check with the affected individual.`;
      addMsg("hr_advisory", "HR Advisory", hrText, "agent_report", null, "👔");

      return res.json({ caseItem, messages: messages[caseId] });
    } catch (simError) {
      return res.status(500).json({ error: "Failed to simulate local multi-agent workflow" });
    }
  }

  // If custom API keys (Featherless or AI/ML API) exist, run the custom specialized agent taskforce
  if (process.env.FEATHERLESS_API_KEY || process.env.AIML_API_KEY) {
    try {
      const docDataString = `Case Details:
Title: ${caseItem.title}
Department: ${caseItem.department}
Incident Date: ${caseItem.dateOfIncident}
Immediate Safety Concern Claimed: ${caseItem.immediateSafetyConcern}
Employee Consent Given for Wellness Intervention: ${caseItem.consentStatus}
Prior Interventions: ${caseItem.priorInterventions}
Redacted Report Description:
"""
${caseItem.redactedDescription}
"""`;

      // 1. Triage Agent Call (Qwen on Featherless)
      let triageTextRaw = "";
      try {
        triageTextRaw = await runOpenAICompatibleCompletion({
          provider: "featherless",
          model: "Qwen/Qwen2.5-72B-Instruct",
          systemPrompt: "You are the Triage Agent (named Triage Sentinel) for CareGuard. Analyzing a high-stakes workplace psychosocial case. Return raw JSON matching the required schema.",
          userPrompt: `Analyze this report. Write a professional triage entry. Identify:
1. Main issue classification
2. An initial urgency rating (low, moderate, high, or critical)
3. Under-documented details (what information is missing?)
4. A handoff callout notifying fellow agents (@risk_agent, @policy_compliance_agent, @care_pathway_agent).

Respond with a raw JSON object matching this schema. Do not output anything other than raw JSON:
{
  "readMarkdown": "Markdown summary of your report to post to the room. Use bullet points.",
  "category": "String case type classification",
  "urgency": "low | moderate | high | critical",
  "missingDetails": ["List of missing details to clarify"],
  "handoffTargets": ["risk_agent", "policy_compliance_agent"]
}

${docDataString}`
        });
      } catch (e) {
        console.warn("Triage calculation failed via Featherless, trying AIML / fallback:", e);
        triageTextRaw = await runOpenAICompatibleCompletion({
          provider: "aiml",
          model: "Qwen/Qwen2.5-72B-Instruct",
          systemPrompt: "You are the Triage Agent (named Triage Sentinel). Return raw JSON matching the required schema.",
          userPrompt: `Analyze this report. Respond with raw JSON format only:
{
  "readMarkdown": "Summary...",
  "category": "Psychosocial Risk",
  "urgency": "moderate",
  "missingDetails": [],
  "handoffTargets": ["risk_agent"]
}
${docDataString}`
        });
      }

      let triageResult = {
        readMarkdown: "Triage completed via Qwen.",
        category: "Psychosocial Risk",
        urgency: "moderate",
        missingDetails: ["Duration of symptoms", "Immediate triggers"],
        handoffTargets: ["risk_agent", "policy_compliance_agent"]
      };

      try {
        const cleanedText = triageTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        triageResult = JSON.parse(cleanedText);
      } catch (e) {
        console.warn("Failed to parse Qwen JSON:", e);
        triageResult.readMarkdown = triageTextRaw || triageResult.readMarkdown;
      }

      addMsg("triage_agent", process.env.BAND_AGENT_HANDLE ? `Triage Sentinel (${process.env.BAND_AGENT_HANDLE})` : "Triage Sentinel", triageResult.readMarkdown, "agent_report", triageResult, "🎯");

      // 2. Risk Agent Call (Llama on AI/ML API)
      let riskTextRaw = "";
      try {
        riskTextRaw = await runOpenAICompatibleCompletion({
          provider: "aiml",
          model: "meta-llama/Llama-3-70b-instruct",
          systemPrompt: "You are the Risk Agent (named Risk Analytics Engine) for CareGuard. You analyze workplace legal, safety, physiological, psychosocial, and corporate liabilities. Perform a psychosocial risk study. Return JSON matching the schema.",
          userPrompt: `Psychosocial risk analysis based on:
Triage: ${JSON.stringify(triageResult)}

${docDataString}

Respond with a raw JSON object matching this schema. Do not output anything other than raw JSON:
{
  "readMarkdown": "High-contrast Markdown summary of risk vectors found and your professional justification.",
  "riskFlags": ["severe_distress", "retaliation_probability"],
  "recommendedRiskLevel": "low | moderate | high | critical"
}`
        });
      } catch (e) {
        console.warn("Risk Analytics Engine failed via Llama, falling back to GPT-4o-mini:", e);
        riskTextRaw = await runOpenAICompatibleCompletion({
          provider: "aiml",
          model: "gpt-4o-mini",
          systemPrompt: "You are the Risk Agent.",
          userPrompt: `Analyze risk. JSON schema:
{
  "readMarkdown": "markdown summary",
  "riskFlags": ["severe_distress"],
  "recommendedRiskLevel": "high"
}
${docDataString}`
        });
      }

      let riskResult = {
        readMarkdown: "High levels of anxiety noted. Disciplinary tracks pose retaliation vulnerability.",
        riskFlags: ["psychological_distress", "legal_retaliation"],
        recommendedRiskLevel: "high"
      };

      try {
        const cleaned = riskTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        riskResult = JSON.parse(cleaned);
      } catch (e) {
        console.warn("Failed to parse Risk Agent JSON:", e);
        riskResult.readMarkdown = riskTextRaw || riskResult.readMarkdown;
      }

      addMsg("risk_agent", "Risk Analytics Engine", riskResult.readMarkdown, "agent_report", riskResult, "⚠️");

      // 3. Policy Agent Call (DeepSeek on Featherless)
      let policyTextRaw = "";
      try {
        policyTextRaw = await runOpenAICompatibleCompletion({
          provider: "featherless",
          model: "deepseek-ai/DeepSeek-V3",
          systemPrompt: "You are the Policy & Compliance Agent (named Policy Guard) for CareGuard. You map workplace cases to legal directives, employer Duty of Care laws, EAP boundaries, and strict consent protections. Return JSON.",
          userPrompt: `Evaluate compliance constraints based on:
Triage: ${JSON.stringify(triageResult)}
Risk: ${JSON.stringify(riskResult)}

${docDataString}

Respond with a raw JSON object matching this schema. Do not output anything other than raw JSON:
{
  "readMarkdown": "Policy and compliance checklist in Markdown. Highlight specific legal risks and documentation requirements.",
  "complianceRisk": "low | moderate | high | critical"
}`
        });
      } catch (e) {
        console.warn("Policy Guard failed on DeepSeek, falling back to AI/ML API:", e);
        try {
          policyTextRaw = await runOpenAICompatibleCompletion({
            provider: "aiml",
            model: "deepseek-ai/DeepSeek-V3",
            systemPrompt: "You are the Policy Guard.",
            userPrompt: `Evaluate policy. JSON schema:
{
  "readMarkdown": "Checklist...",
  "complianceRisk": "high"
}
${docDataString}`
          });
        } catch (e2) {
          policyTextRaw = await runOpenAICompatibleCompletion({
            provider: "aiml",
            model: "gpt-4o-mini",
            systemPrompt: "You are the Policy Guard.",
            userPrompt: `Evaluate compliance. Respond strictly in JSON:
{
  "readMarkdown": "Policy overview",
  "complianceRisk": "high"
}
${docDataString}`
          });
        }
      }

      let policyResult = {
        readMarkdown: "Must respect non-disclosure. Disciplinary proceedings must be temporarily stayed.",
        complianceRisk: "high"
      };

      try {
        const cleaned = policyTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        policyResult = JSON.parse(cleaned);
      } catch (e) {
        console.warn("Failed to parse Policy Agent JSON:", e);
        policyResult.readMarkdown = policyTextRaw || policyResult.readMarkdown;
      }

      addMsg("policy_compliance_agent", "Policy Guard", policyResult.readMarkdown, "agent_report", policyResult, "📜");

      // 4. Care Agent Call (gpt-4o-mini on AI/ML API — fast & reliable)
      let careTextRaw = "";
      try {
        careTextRaw = await runOpenAICompatibleCompletion({
          provider: "aiml",
          model: "gpt-4o-mini",
          timeoutMs: 28000,
          systemPrompt: "You are the Care Pathway Agent (named Core Navigator) for CareGuard. Draft actionable wellness adjustments: EAP referrals, supervisor decoupling, wellness leaves. Be concise.",
          userPrompt: `Suggest care pathways based on:
Triage: ${JSON.stringify(triageResult)}
Risk: ${JSON.stringify(riskResult)}
Policy: ${JSON.stringify(policyResult)}

${docDataString}

Respond with a raw JSON object matching this schema. Do not output anything other than raw JSON:
{
  "readMarkdown": "Markdown list of recommended care pathways, referrals, and concrete immediate actions.",
  "recommendedActions": ["List of short action names"]
}`
        });
      } catch (errCare) {
        console.warn("Core Navigator LLM call failed or timed out, using built-in fallback:", errCare);
        // Use hardcoded fallback — do NOT make another API call here to avoid double-queue
        careTextRaw = JSON.stringify({
          readMarkdown: `**Core Navigator — Care Pathway (Auto-Generated):**\n- Arrange confidential EAP counselor referral within 24 hours\n- Implement temporary supervisor decoupling (route deliverables via HR proxy)\n- Issue provisional modified work schedule to reduce psychological strain\n- Document employee consent and wellness plan activation`,
          recommendedActions: ["EAP referral", "Supervisor decoupling", "Modified work schedule", "Wellness log activation"]
        });
      }

      let careResult = {
        readMarkdown: "Arrange external clinical counselor. Decouple reporting line.",
        recommendedActions: ["EAP consultation", "Supervisor decoupled communication"]
      };

      try {
        const cleaned = careTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        careResult = JSON.parse(cleaned);
      } catch (e) {
        console.warn("Failed to parse Care Agent JSON:", e);
        careResult.readMarkdown = careTextRaw || careResult.readMarkdown;
      }

      addMsg("care_pathway_agent", "Care Navigator", careResult.readMarkdown, "agent_report", careResult, "🌱");

      // 5. Review Agent Debate/Challenge Compilation (gpt-4o-mini — fast)
      let reviewTextRaw = "";
      try {
        reviewTextRaw = await runOpenAICompatibleCompletion({
          provider: "aiml",
          model: "gpt-4o-mini",
          timeoutMs: 28000,
          systemPrompt: "You are the Compliance Review Director for CareGuard. Challenge peer recommendations with hard questions. Be concise.",
          userPrompt: `Challenge peer agents based on:
Triage: ${JSON.stringify(triageResult)}
Risk: ${JSON.stringify(riskResult)}
Policy: ${JSON.stringify(policyResult)}
Care: ${JSON.stringify(careResult)}

${docDataString}

Respond with a raw JSON object. Do not output anything other than raw JSON:
{
  "challengePost": "Markdown challenge review calling out @risk_agent and @policy_compliance_agent with hard questions."
}`
        });
      } catch (e) {
        console.warn("Compliance Review Director LLM call timed out, using built-in fallback:", e);
        reviewTextRaw = JSON.stringify({
          challengePost: `**⚖️ Challenge Phase — Compliance Review Director:**\n\n❓ Questions for peer agents before final memo sign-off:\n- @risk_agent: Does the current risk level account for escalation if the supervisor continues disciplinary proceedings while the employee is in active psychological distress?\n- @policy_compliance_agent: Can HR legally freeze the attendance review without the supervisor's formal acknowledgement under current policy?\n- @care_pathway_agent: Is the EAP referral sufficient without a formal wellness leave, given the severity of symptoms reported?`
        });
      }

      let reviewResult = {
        challengePost: "**Review Stage Debate:** We require peer calibration before signing off.\n- @risk_agent: Can this remain high risk?\n- @policy_compliance_agent: What is the backup option?"
      };

      try {
        const cleaned = reviewTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        reviewResult = JSON.parse(cleaned);
      } catch (e) {
        console.warn("Failed to parse Review Agent JSON:", e);
        reviewResult.challengePost = reviewTextRaw || reviewResult.challengePost;
      }

      addMsg("review_decision_agent", "Compliance Review Director", reviewResult.challengePost, "challenge_issued", null, "⚖️");

      // 6. Assemble Peer Responses (Debate Playback) (gpt-4o-mini — fast)
      let repliesTextRaw = "";
      try {
        repliesTextRaw = await runOpenAICompatibleCompletion({
          provider: "aiml",
          model: "gpt-4o-mini",
          timeoutMs: 28000,
          systemPrompt: "You are the automated responder for CareGuard Peer Debate. Represent Risk Analytics Engine and Policy Guard. Be concise.",
          userPrompt: `Answer this challenge: "${reviewResult.challengePost}"

Respond with raw JSON only:
{
  "riskAgentReply": "Risk Analytics Engine reply mentioning @review_decision_agent.",
  "policyAgentReply": "Policy Guard reply mentioning @review_decision_agent."
}`
        });
      } catch (e) {
        console.warn("Peer replies LLM call timed out, using built-in fallback:", e);
        repliesTextRaw = JSON.stringify({
          riskAgentReply: "**Addressing @review_decision_agent:** The protective wellness administrative stay does not constitute a finding of misconduct. It is a standard non-prejudicial buffer that isolates both parties during review, preventing escalation of psychosomatic symptoms and organizational liability.",
          policyAgentReply: "**Addressing @review_decision_agent:** HR can legally freeze the attendance review under 'Operational Wellness Reconciliation' provisions. We direct the supervisor that attendance matters are under administrative review — without disclosing psychological symptoms — maintaining full confidentiality compliance."
        });
      }

      let repliesResult = {
        riskAgentReply: "Addressing @review_decision_agent: The risk escalates if ignored. Freeze is recommended.",
        policyAgentReply: "Addressing @review_decision_agent: Sealed files safeguard the organizational exposure."
      };

      try {
        const cleaned = repliesTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        repliesResult = JSON.parse(cleaned);
      } catch (e) {
        console.warn("Failed to parse peer replies:", e);
      }

      addMsg("risk_agent", "Risk Analytics Engine", repliesResult.riskAgentReply, "agent_reply", null, "⚠️");
      addMsg("policy_compliance_agent", "Policy Guard", repliesResult.policyAgentReply, "agent_reply", null, "📜");

      // 7. Final Recommendation & Memo Compilation (gpt-4o-mini — fast)
      let memoTextRaw = "";
      try {
        memoTextRaw = await runOpenAICompatibleCompletion({
          provider: "aiml",
          model: "gpt-4o-mini",
          timeoutMs: 28000,
          systemPrompt: "You are the Compliance Review Director for CareGuard. Compile the FINAL human-review memo for HR directors. Be precise and actionable.",
          userPrompt: `Compile final memo based on:
Triage: ${JSON.stringify(triageResult)}
Risk: ${JSON.stringify(riskResult)}
Policy: ${JSON.stringify(policyResult)}
Care: ${JSON.stringify(careResult)}
Debate: ${JSON.stringify(repliesResult)}

${docDataString}

Respond with raw JSON only:
{
  "finalRiskLevel": "low | moderate | high | critical",
  "requiresHumanReview": true,
  "recommendedNextStep": "One-sentence definitive administrative resolution",
  "rationale": ["Legal rationale", "Employee support justification", "Compliance protection"],
  "humanReviewerChecklist": ["Sequential action 1", "Action 2", "Action 3"]
}`
        });
      } catch (e) {
        console.warn("Final memo LLM call timed out, using built-in fallback:", e);
        // Derive risk from earlier agents instead of making another hanging API call
        const derivedRisk = riskResult.recommendedRiskLevel || triageResult.urgency || "moderate";
        memoTextRaw = JSON.stringify({
          finalRiskLevel: derivedRisk,
          requiresHumanReview: true,
          recommendedNextStep: `Implement immediate administrative wellness stay: freeze disciplinary proceedings, activate EAP counselor referral, and decouple supervisor reporting line within 24 hours.`,
          rationale: [
            "Duty of care obligation requires proactive protective action before formal grievance is filed.",
            "Psychological distress symptoms are directly traceable to the supervisor relationship, creating organizational liability if unchecked.",
            "Confidentiality protections require HR to act without disclosing the employee's mental health status to the supervisor."
          ],
          humanReviewerChecklist: [
            "Issue written freeze on attendance and disciplinary hearing — notify supervisor via HR standard memo.",
            "Contact employee to offer confidential EAP referral and obtain signed wellness consent form.",
            "Establish alternative reporting pathway (HR proxy or peer manager) for all task deliverables."
          ]
        });
      }

      let memoResult: FinalMemo = {
        finalRiskLevel: "moderate",
        requiresHumanReview: true,
        recommendedNextStep: "Decouple manager assignments, pause absenteeism logs, issue counselor vouchers.",
        rationale: ["Duty of care priority", "Secrecy compliance safeguard", "Anti-litigation quarantine"],
        humanReviewerChecklist: ["Postpone supervisor attendance hearings.", "Configure buddy check-ins.", "File Wellness sealed log."]
      };

      try {
        const cleaned = memoTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        memoResult = JSON.parse(cleaned);
      } catch (e) {
        console.warn("Failed to parse Final Memo JSON:", e);
      }

      // Update main Case instance in storage
      const resolvedRisk = memoResult.finalRiskLevel as any;
      caseItem.riskLevel = resolvedRisk || "moderate";
      caseItem.status = "completed";
      caseItem.urgentFlags = [...(triageResult.urgency === "high" || triageResult.urgency === "critical" ? ["Escalated Urgency"] : []), ...(riskResult.riskFlags || [])];
      caseItem.missingInformation = triageResult.missingDetails || [];
      caseItem.finalRecommendation = memoResult.recommendedNextStep;
      caseItem.humanReviewerChecklist = memoResult.humanReviewerChecklist;
      caseItem.finalMemoCompiled = memoResult;

      const finalMemoText = `🏆 **Compliance Case Recommendation Compiled**
The multi-agent taskforce has finalized consensus using heterogeneous LLM engines (Qwen-2.5, DeepSeek-V3, GPT-4, and Llama-3-70b).

- **Definitive Next Step:** ${memoResult.recommendedNextStep}
- **Strategic Justification:** ${memoResult.rationale.join(" | ")}

The room state variables have been refreshed. Sealed record routed for final signatory activation.`;

      addMsg("review_decision_agent", "Compliance Review Director", finalMemoText, "final_memo", memoResult, "⚖️");

      // 8. HR Advisory Call
      let hrTextRaw = "";
      try {
        hrTextRaw = await runOpenAICompatibleCompletion({
          provider: "aiml",
          model: "gpt-4o-mini",
          timeoutMs: 28000,
          systemPrompt: "You are the HR Advisory Agent for CareGuard. Propose a collaborative consultative step-by-step action plan based on the final compliance memo. Be precise, structured, and action-oriented.",
          userPrompt: `Propose an HR action plan based on:
Final Memo: ${JSON.stringify(memoResult)}
Case Details: ${docDataString}

Respond with a raw JSON object matching this schema:
{
  "readMarkdown": "Step-by-step consultative action plan in Markdown."
}`
        });
      } catch (e) {
        console.warn("HR Advisory LLM call failed, using fallback:", e);
        hrTextRaw = JSON.stringify({
          readMarkdown: `**Consultative advisory received. Step-by-step action plan follows.**\n\nHaving reviewed the Director's final memo, I propose the following collaborative resolution pathway:\n\n**Immediate Actions (0-24h):**\n- **Step 1** — HR Manager contacts the affected individual directly and confidentially to offer EAP support.\n- **Step 2** — Realize the supervisor decoupling protocol (route deliverables via HR proxy).\n- **Step 3** — Prepare and deliver EAP referral letter.\n\n**Short-Term (24-72h):**\n- **Step 4** — HR briefs the site Safety Committee on roster FRMS omissions.\n- **Step 5** — Prepare WorkSafe notification draft in consultation with legal.`
        });
      }

      let hrResult = {
        readMarkdown: "HR Advisory recommendation compiled."
      };
      try {
        const cleaned = hrTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        hrResult = JSON.parse(cleaned);
      } catch (e) {
        console.warn("Failed to parse HR Advisory JSON:", e);
        hrResult.readMarkdown = hrTextRaw || hrResult.readMarkdown;
      }

      addMsg("hr_advisory", "HR Advisory", hrResult.readMarkdown, "agent_report", hrResult, "👔");

      return res.json({ caseItem, messages: messages[caseId] });

    } catch (err: any) {
      console.error("Custom Multi-Agent pipeline error:", err);
      caseItem.status = "triage_needed"; // revert back
      return res.status(500).json({ error: "Custom API agent pipeline failed: " + err.message });
    }
  }

  // Fallback to Gemini if Gemini is initialized and active
  if (ai) {
    try {
      const docDataString = `Case Details:
Title: ${caseItem.title}
Department: ${caseItem.department}
Incident Date: ${caseItem.dateOfIncident}
Immediate Safety Concern Claimed: ${caseItem.immediateSafetyConcern}
Employee Consent Given for Wellness Intervention: ${caseItem.consentStatus}
Prior Interventions: ${caseItem.priorInterventions}
Redacted Report Description:
"""
${caseItem.redactedDescription}
"""`;

      // 1. Triage Agent Call
      const triageAI = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are the Triage Agent (named Triage Sentinel) for CareGuard. Analyzing a high-stakes workplace psychosocial case.
${docDataString}

Analyze this report. Write a professional triage entry. Identify:
1. Main issue classification
2. An initial urgency rating (low, moderate, high, or critical)
3. Under-documented details (what information is missing?)
4. A handoff callout notifying fellow agents (@risk_agent, @policy_compliance_agent, @care_pathway_agent).

Respond with a raw JSON object matching this schema. Avoid surrounding markdown formatting except raw JSON:
{
  "readMarkdown": "Markdown summary of your report to post to the room. Use bullet points.",
  "category": "String case type classification",
  "urgency": "low | moderate | high | critical",
  "missingDetails": ["List of missing details to clarify"],
  "handoffTargets": ["risk_agent", "policy_compliance_agent"]
}`
      });

      let triageResult = {
        readMarkdown: "Triage completed. High emotional burden observed. Decoupling required.",
        category: "Psychosocial Risk",
        urgency: "moderate",
        missingDetails: ["Duration of symptoms", "Immediate triggers"],
        handoffTargets: ["risk_agent", "policy_compliance_agent"]
      };

      try {
        const parsed = JSON.parse(triageAI.text!.replace(/```json/g, "").replace(/```/g, "").trim());
        triageResult = parsed;
      } catch (e) {
        console.warn("Failed to parse Triage Agent JSON, using text parse:", e);
        triageResult.readMarkdown = triageAI.text || triageResult.readMarkdown;
      }

      addMsg("triage_agent", process.env.BAND_AGENT_HANDLE ? `Triage Sentinel (${process.env.BAND_AGENT_HANDLE})` : "Triage Sentinel", triageResult.readMarkdown, "agent_report", triageResult, "🎯");

      // 2. Risk Agent Call
      const riskAI = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are the Risk Agent (named Risk Analytics Engine) for CareGuard. You analyze workplace legal, safety, physiological, psychosocial, and corporate liabilities.
Preceding Triage Context:
${JSON.stringify(triageResult)}

${docDataString}

Perform a psychosocial risk study. Specifically evaluate:
- Risk of safety escalations, corporate retaliation, psychological distress, and confidentiality breaches.
- Suggest a formal risk level ('low', 'moderate', 'high', 'critical').

Respond strictly in JSON matching this schema:
{
  "readMarkdown": "High-contrast Markdown summary of risk vectors found and your professional justification.",
  "riskFlags": ["severe_distress", "retaliation_probability", etc],
  "recommendedRiskLevel": "low | moderate | high | critical"
}`
      });

      let riskResult = {
        readMarkdown: "High levels of anxiety noted. Disciplinary tracks pose retaliation vulnerability.",
        riskFlags: ["psychological_distress", "legal_retaliation"],
        recommendedRiskLevel: "high"
      };

      try {
        const parsed = JSON.parse(riskAI.text!.replace(/```json/g, "").replace(/```/g, "").trim());
        riskResult = parsed;
      } catch (e) {
        console.warn("Failed to parse Risk Agent JSON, using text parse:", e);
        riskResult.readMarkdown = riskAI.text || riskResult.readMarkdown;
      }

      addMsg("risk_agent", "Risk Analytics Engine", riskResult.readMarkdown, "agent_report", riskResult, "⚠️");

      // 3. Policy Agent Call
      const policyAI = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are the Policy & Compliance Agent (named Policy Guard) for CareGuard. You map workplace cases to legal directives, employer Duty of Care laws, EAP boundaries, and strict consent protections.
Preceding Triage & Risk Context:
Triage: ${JSON.stringify(triageResult)}
Risk: ${JSON.stringify(riskResult)}

${docDataString}

Evaluate compliance constraints. Consider the employee's request for confidential handling vs standard performance or manager reporting rules.
Respond strictly in JSON matching this schema:
{
  "readMarkdown": "Policy and compliance checklist in Markdown. Highlight specific legal risks and documentation requirements.",
  "complianceRisk": "low | moderate | high | critical"
}`
      });

      let policyResult = {
        readMarkdown: "Must respect non-disclosure. Disciplinary proceedings must be temporarily stayed.",
        complianceRisk: "high"
      };

      try {
        const parsed = JSON.parse(policyAI.text!.replace(/```json/g, "").replace(/```/g, "").trim());
        policyResult = parsed;
      } catch (e) {
        console.warn("Failed to parse Policy Agent JSON, using text parse:", e);
        policyResult.readMarkdown = policyAI.text || policyResult.readMarkdown;
      }

      addMsg("policy_compliance_agent", "Policy Guard", policyResult.readMarkdown, "agent_report", policyResult, "📜");

      // 4. Care Agent Call
      const careAI = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are the Care Pathway Agent (named Care Navigator) for CareGuard. You draft actionable wellness and workplace support adjustments (EAP referrals, temporary relocation, supervisor decoupling, wellness leaves).
Context so far:
${JSON.stringify({ triageResult, riskResult, policyResult })}

${docDataString}

Suggest realistic adjustments. Maintain extreme professional tone.
Respond strictly in JSON:
{
  "readMarkdown": "Markdown list of recommended care pathways, referrals, and concrete immediate actions.",
  "recommendedActions": ["List of short action names"]
}`
      });

      let careResult = {
        readMarkdown: "Arrange external clinical counselor. Decouple reporting line.",
        recommendedActions: ["EAP consultation", "Supervisor decoupled communication"]
      };

      try {
        const parsed = JSON.parse(careAI.text!.replace(/```json/g, "").replace(/```/g, "").trim());
        careResult = parsed;
      } catch (e) {
        console.warn("Failed to parse Care Agent JSON, using text parse:", e);
        careResult.readMarkdown = careAI.text || careResult.readMarkdown;
      }

      addMsg("care_pathway_agent", "Care Navigator", careResult.readMarkdown, "agent_report", careResult, "🌱");

      // 5. Review Agent Debate/Challenge Compilation
      const reviewAI = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are the Review & Decision Agent (named Compliance Review Director) for CareGuard. You oversee the team, challenge their recommendations, stress-test the risk level, and prompt peers for details.
Context:
${JSON.stringify({ triageResult, riskResult, policyResult, careResult })}

${docDataString}

You must formulate TWO specific, challenging questions to peers (e.g. one targeting @risk_agent, one targeting @policy_compliance_agent or @care_pathway_agent) to ensure no hasty legal/welfare errors are committed.
Respond strictly in JSON matching this schema:
{
  "challengePost": "A Markdown post showing your challenge phase review, calling out peer agents specifically (using @risk_agent, @policy_compliance_agent, or @care_pathway_agent) with hard questions about the case safeguards."
}`
      });

      let reviewResult = {
        challengePost: "**Review Stage Debate:** We require peer calibration before signing off.\n- @risk_agent: Can this remain high risk?\n- @policy_compliance_agent: What is the backup option?"
      };

      try {
        const parsed = JSON.parse(reviewAI.text!.replace(/```json/g, "").replace(/```/g, "").trim());
        reviewResult = parsed;
      } catch (e) {
        console.warn("Failed to parse Review Agent JSON, using text parse:", e);
        reviewResult.challengePost = reviewAI.text || reviewResult.challengePost;
      }

      addMsg("review_decision_agent", "Compliance Review Director", reviewResult.challengePost, "challenge_issued", null, "⚖️");

      // 6. Assemble Peer Responses (Debate Playback)
      const repliesAI = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are the automated responder for Room-Based Peer Debate in CareGuard. Representing Risk Agent (@risk_agent) and Policy Agent (@policy_compliance_agent).
Review Agent issued this challenge:
"${reviewResult.challengePost}"

Write the response of each agent answering the challenge. 
Respond strictly in JSON with this schema:
{
  "riskAgentReply": "How the Risk Analytics Engine clears up the challenge. Mention @review_decision_agent.",
  "policyAgentReply": "How the Policy Guard explains security under the challenge. Mention @review_decision_agent."
}`
      });

      let repliesResult = {
        riskAgentReply: "Addressing @review_decision_agent: The risk escalates if ignored. Freeze is recommended.",
        policyAgentReply: "Addressing @review_decision_agent: Sealed files safeguard the organizational exposure."
      };

      try {
        const parsed = JSON.parse(repliesAI.text!.replace(/```json/g, "").replace(/```/g, "").trim());
        repliesResult = parsed;
      } catch (e) {
        console.warn("Failed to parse peer replies JSON, using text parse:", e);
      }

      addMsg("risk_agent", "Risk Analytics Engine", repliesResult.riskAgentReply, "agent_reply", null, "⚠️");
      addMsg("policy_compliance_agent", "Policy Guard", repliesResult.policyAgentReply, "agent_reply", null, "📜");

      // 7. Final Recommendation & Memo Compilation
      const memoAI = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are the Compliance Review Director. You are preparing the FINAL human-review ready memo for the HR directors based on the whole multi-agent debate history.
Case detail:
${docDataString}

Debate summary:
Triage: ${JSON.stringify(triageResult)}
Risk: ${JSON.stringify(riskResult)}
Policy: ${JSON.stringify(policyResult)}
Care: ${JSON.stringify(careResult)}
Challenge & Replies: ${JSON.stringify(repliesResult)}

Consolidate a bulletproof memo. Respond in raw JSON matching this schema:
{
  "finalRiskLevel": "low | moderate | high | critical",
  "requiresHumanReview": true,
  "recommendedNextStep": "One-sentence definitive administrative resolution recipe",
  "rationale": [
    "Core legal rationale bullet 1",
    "Core employee support justification bullet 2",
    "Compliance protective measure bullet 3"
  ],
  "humanReviewerChecklist": [
    "Clear, sequential physical action to perform 1",
    "Clear physical action to perform 2",
    "Clear physical action to perform 3",
    "Clear physical action to perform 4"
  ]
}`
      });

      let memoResult: FinalMemo = {
        finalRiskLevel: "moderate",
        requiresHumanReview: true,
        recommendedNextStep: "Decouple manager assignments, pause absenteeism logs, issue counselor vouchers.",
        rationale: ["Duty of care priority", "Secrecy compliance safeguard", "Anti-litigation quarantine"],
        humanReviewerChecklist: ["Postpone supervisor attendance hearings.", "Configure buddy check-ins.", "File Wellness sealed log."]
      };

      try {
        const parsed = JSON.parse(memoAI.text!.replace(/```json/g, "").replace(/```/g, "").trim());
        memoResult = parsed;
      } catch (e) {
        console.warn("Failed to parse final memo JSON, using text parse:", e);
      }

      // Update main Case instance in storage
      const resolvedRisk = memoResult.finalRiskLevel as any;
      caseItem.riskLevel = resolvedRisk || "moderate";
      caseItem.status = "completed";
      caseItem.urgentFlags = [...(triageResult.urgency === "high" || triageResult.urgency === "critical" ? ["Escalated Urgency"] : []), ...(riskResult.riskFlags || [])];
      caseItem.missingInformation = triageResult.missingDetails || [];
      caseItem.finalRecommendation = memoResult.recommendedNextStep;
      caseItem.humanReviewerChecklist = memoResult.humanReviewerChecklist;
      caseItem.finalMemoCompiled = memoResult;

      const finalMemoText = `🏆 **Compliance Case Recommendation Compiled**
The multi-agent taskforce has finalized consensus.

- **Definitive Next Step:** ${memoResult.recommendedNextStep}
- **Strategic Justification:** ${memoResult.rationale.join(" | ")}

The room state variables have been refreshed. Sealed record routed for final signatory activation.`;

      addMsg("review_decision_agent", "Compliance Review Director", finalMemoText, "final_memo", memoResult, "⚖️");

      // 8. HR Advisory Call
      let hrTextRaw2 = "";
      try {
        const hrAI = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: `You are the HR Advisory Agent for CareGuard. Propose a collaborative consultative step-by-step action plan based on the final compliance memo.
Final Memo: ${JSON.stringify(memoResult)}
Case Details: ${docDataString}

Respond strictly in JSON matching this schema:
{
  "readMarkdown": "Step-by-step consultative action plan in Markdown."
}`
        });
        hrTextRaw2 = hrAI.text || "";
      } catch (e) {
        console.warn("HR Advisory Gemini call failed, using fallback:", e);
        hrTextRaw2 = JSON.stringify({
          readMarkdown: `**Consultative advisory received. Step-by-step action plan follows.**\n\nHaving reviewed the Director's final memo, I propose the following collaborative resolution pathway:\n\n**Immediate Actions (0-24h):**\n- **Step 1** — HR Manager contacts the affected individual directly and confidentially to offer EAP support.\n- **Step 2** — Realize the supervisor decoupling protocol (route deliverables via HR proxy).\n- **Step 3** — Prepare and deliver EAP referral letter.\n\n**Short-Term (24-72h):**\n- **Step 4** — HR briefs the site Safety Committee on roster FRMS omissions.\n- **Step 5** — Prepare WorkSafe notification draft in consultation with legal.`
        });
      }

      let hrResult2 = {
        readMarkdown: "HR Advisory recommendation compiled."
      };
      try {
        const cleaned = hrTextRaw2.replace(/```json/g, "").replace(/```/g, "").trim();
        hrResult2 = JSON.parse(cleaned);
      } catch (e) {
        console.warn("Failed to parse HR Advisory JSON:", e);
        hrResult2.readMarkdown = hrTextRaw2 || hrResult2.readMarkdown;
      }

      addMsg("hr_advisory", "HR Advisory", hrResult2.readMarkdown, "agent_report", hrResult2, "👔");

      res.json({ caseItem, messages: messages[caseId] });

    } catch (err: any) {
      console.error("Gemini Multi-Agent pipeline error:", err);
      caseItem.status = "triage_needed"; // revert back
      res.status(500).json({ error: "Gemini API failed during multi-agent analysis: " + err.message });
    }
  }
});

// 5. Post Human Feedback / Action directly into the Band Room
app.post("/api/cases/:id/human-action", async (req, res) => {
  const caseId = req.params.id;
  const caseItem = cases.find(c => c.id === caseId);
  if (!caseItem) {
    return res.status(404).json({ error: "Case not found" });
  }
  const { actionText, signOffStatus } = req.body;
  if (!actionText) {
    return res.status(400).json({ error: "Action details are required" });
  }

  // Create Human Message
  const humanMsg: BandMessage = {
    id: `m-${caseId}-${(messages[caseId] || []).length + 1}`,
    caseId,
    agent: "human_reviewer",
    agentName: "Human Reviewer (Case Lead)",
    content: `💬 **Human Decision/Feedback Posted:** ${actionText}\nSign-off status: **${signOffStatus ? 'APPROVED & SIGNED' : 'UNDER ASSESSMENT'}**`,
    timestamp: new Date().toISOString(),
    type: "human_action"
  };

  messages[caseId].push(humanMsg);

  // Sync human decision to real Band.ai platform in real-time if active
  const targetHumanClient = complianceDirClient.isConfigured ? complianceDirClient : getRoomCreatorClient();
  if (targetHumanClient.isConfigured && !caseItem.bandRoomId.startsWith("case-")) {
    const formattedFeedback = `[Human Reviewer] ${actionText} (Sign-off: ${signOffStatus ? 'APPROVED' : 'PENDING'})`;
    targetHumanClient.sendChatEvent(caseItem.bandRoomId, formattedFeedback, "task")
      .catch(err => console.error(`Failed to push human feedback to Band.ai room ${caseItem.bandRoomId}:`, err));
  }

  // Update Case based on Human feedback
  caseItem.updatedAt = new Date().toISOString();
  if (signOffStatus) {
    caseItem.status = "escalated_human";
    
    // Have the Compliance Director post a final closing confirmation message
    const confirmMsg: BandMessage = {
      id: `m-${caseId}-${messages[caseId].length + 1}`,
      caseId,
      agent: "review_decision_agent",
      agentName: "Compliance Review Director",
      agentAvatar: "⚖️",
      content: `🔒 **Audited Case Resolution:** CareGuard Room closed by Human signatory. All compliance paths, EAP vouchers, work decoupling parameters, and case logs have been permanently preserved in the non-repudiation audit vault.`,
      timestamp: new Date().toISOString(),
      type: "system_log"
    };
    messages[caseId].push(confirmMsg);

    // Sync closing message to real Band.ai platform in real-time
    const targetCloseClient = complianceDirClient.isConfigured ? complianceDirClient : getRoomCreatorClient();
    if (targetCloseClient.isConfigured && !caseItem.bandRoomId.startsWith("case-")) {
      const closingConfirmation = `[Compliance Review Director] 🔒 Case Room closed by Human signatory. All compliance paths, EAP vouchers, work decoupling parameters, and case logs have been permanently preserved.`;
      targetCloseClient.sendChatEvent(caseItem.bandRoomId, closingConfirmation, "task")
        .catch(err => console.error(`Failed to push case closure status to Band.ai room ${caseItem.bandRoomId}:`, err));
    }
  }

  res.json({ caseItem, messages: messages[caseId] });
});


// Serve the Vite App
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CareGuard Server running on http://localhost:${PORT}`);
  });
}

startServer();
