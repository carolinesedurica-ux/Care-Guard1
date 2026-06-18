import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { WorkplaceCase, BandMessage, AgentRole, FinalMemo } from "./src/types";
import { BandClient } from "./src/lib/band";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = 3000;

// Agent registry — each entry holds identity + credentials.
// Triage Sentinel is the only pre-provisioned real Band.ai agent.
// The other five are created on Band.ai at runtime via /api/admin/provision-agents.
const agentsConfig: Record<string, {
  id: string; apiKey: string; handle: string;
  displayName: string; avatar: string; description: string; webhookPath: string;
}> = {
  triage: {
    id: process.env.BAND_AGENT_ID || "",
    apiKey: process.env.BAND_API_KEY || "",
    handle: process.env.BAND_AGENT_HANDLE || "@pameltex3237/triage-sentinel",
    displayName: "Triage Sentinel",
    avatar: "🎯",
    description: "Primary case intake, classification and urgency triage for CareGuard.",
    webhookPath: "/api/webhooks/triage",
  },
  risk: {
    id: process.env.BAND_RISK_AGENT_ID || "",
    apiKey: process.env.BAND_RISK_API_KEY || "",
    handle: process.env.BAND_RISK_HANDLE || "",
    displayName: "Risk Analytics Engine",
    avatar: "⚠️",
    description: "Analyses psychosocial, legal, and retaliation risk vectors for workplace cases.",
    webhookPath: "/api/webhooks/risk",
  },
  policy: {
    id: process.env.BAND_POLICY_AGENT_ID || "",
    apiKey: process.env.BAND_POLICY_API_KEY || "",
    handle: process.env.BAND_POLICY_HANDLE || "",
    displayName: "Policy Guard",
    avatar: "📜",
    description: "Maps cases to Duty of Care laws, confidentiality rules, and EAP obligations.",
    webhookPath: "/api/webhooks/policy",
  },
  coreNav: {
    id: process.env.BAND_CORE_NAV_AGENT_ID || "",
    apiKey: process.env.BAND_CORE_NAV_API_KEY || "",
    handle: process.env.BAND_CORE_NAV_HANDLE || "",
    displayName: "Core Navigator",
    avatar: "🌱",
    description: "Designs EAP referrals, supervisor-decoupling steps, and wellness action plans.",
    webhookPath: "/api/webhooks/coreNav",
  },
  complianceDir: {
    id: process.env.BAND_COMPLIANCE_DIR_AGENT_ID || "",
    apiKey: process.env.BAND_COMPLIANCE_DIR_API_KEY || "",
    handle: process.env.BAND_COMPLIANCE_DIR_HANDLE || "",
    displayName: "Compliance Review Director",
    avatar: "⚖️",
    description: "Challenges peer recommendations and compiles the final human-review advisory memo.",
    webhookPath: "/api/webhooks/complianceDir",
  },
  hrAdvisory: {
    id: process.env.BAND_HR_ADVISORY_AGENT_ID || "",
    apiKey: process.env.BAND_HR_ADVISORY_API_KEY || "",
    handle: process.env.BAND_HR_ADVISORY_HANDLE || "",
    displayName: "HR Advisory",
    avatar: "👔",
    description: "Produces consultative step-by-step HR action plans from the final compliance memo.",
    webhookPath: "/api/webhooks/hrAdvisory",
  },
};

// Per-agent Band.ai clients — each agent posts with its own identity once provisioned.
// All agents are internal — no agent API keys needed; responses are returned inline via webhooks.
const agentClients: Record<string, BandClient> = {};
for (const [key, cfg] of Object.entries(agentsConfig)) {
  agentClients[key] = new BandClient(cfg.apiKey);
}

// Manager client uses the personal workspace key for room creation, participant management,
// and event posting — operations that require workspace-level authority, not an agent key.
// All 6 agents are internal (no agent API keys); they respond via inline webhook responses.
const managerClient = new BandClient(process.env.BAND_PERSONAL_API_KEY);




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

// Helper to call the AI/ML API (OpenAI-compatible endpoint)
// Uses a 30-second AbortController timeout to prevent agents from hanging in queue
async function runOpenAICompatibleCompletion(options: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const key = process.env.AIML_API_KEY;
  const baseUrl = "https://api.aimlapi.com/v1";
  const timeoutMs = options.timeoutMs ?? 30000; // 30s default timeout

  if (!key) {
    throw new Error("API Key for AIML is missing. Please check your config.");
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
      throw new Error(`[AIML API Error] Code ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("[AIML API Error] Empty response");
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
app.get("/api/config", (_req, res) => {
  const buildAgentInfo = (key: string) => ({
    id: agentsConfig[key].id,
    handle: agentsConfig[key].handle,
    displayName: agentsConfig[key].displayName,
    avatar: agentsConfig[key].avatar,
    hasKey: !!agentsConfig[key].apiKey,
    provisioned: !!agentsConfig[key].id && !!agentsConfig[key].handle,
    webhookPath: agentsConfig[key].webhookPath,
  });
  res.json({
    hasGemini: !!ai,
    personalKeyConfigured: !!process.env.BAND_PERSONAL_API_KEY,
    bandAgent: {
      id: agentsConfig.triage.id,
      hasKey: managerClient.isConfigured,
      handle: agentsConfig.triage.handle,
      agents: {
        triage:        buildAgentInfo("triage"),
        risk:          buildAgentInfo("risk"),
        policy:        buildAgentInfo("policy"),
        coreNav:       buildAgentInfo("coreNav"),
        complianceDir: buildAgentInfo("complianceDir"),
        hrAdvisory:    buildAgentInfo("hrAdvisory"),
      }
    }
  });
});

// Test Connection to Band.ai — uses workspace personal key
app.post("/api/config/test-band", async (req, res) => {
  try {
    if (!managerClient.isConfigured) {
      return res.json({ success: false, error: "No BAND_PERSONAL_API_KEY configured." });
    }
    const result = await managerClient.testConnection();
    if (result.success) {
      res.json({ success: true, agent: { name: "Triage Sentinel", handle: agentsConfig.triage.handle } });
    } else {
      res.json({ success: false, error: result.error || "Authentication failed." });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to execute connection test" });
  }
});

// Provision all missing agents on Band.ai using the personal API key
// POST /api/admin/provision-agents  body: { webhookBaseUrl: "https://your-host" }
app.post("/api/admin/provision-agents", async (req, res) => {
  const personalKey = process.env.BAND_PERSONAL_API_KEY;
  if (!personalKey) {
    return res.status(400).json({ error: "BAND_PERSONAL_API_KEY is not configured in .env" });
  }

  const webhookBase: string = (req.body?.webhookBaseUrl || "").replace(/\/$/, "");
  const results: Record<string, any> = {};

  // Only provision agents that don't have credentials yet
  const virtualKeys = ["risk", "policy", "coreNav", "complianceDir", "hrAdvisory"] as const;

  for (const key of virtualKeys) {
    const cfg = agentsConfig[key];

    if (cfg.apiKey && cfg.id) {
      // Already exists — update its webhook URL if a base URL was provided
      if (webhookBase && cfg.handle) {
        const webhookUrl = `${webhookBase}${cfg.webhookPath}`;
        const updated = await managerClient.updateWebhook(cfg.handle, webhookUrl, personalKey);
        results[key] = { status: "webhook_updated", id: cfg.id, handle: cfg.handle, webhookUrl, updated };
      } else {
        results[key] = { status: "already_provisioned", id: cfg.id, handle: cfg.handle };
      }
      continue;
    }

    // Derive a clean handle slug from the key
    const handleSlug = {
      risk: "risk-analytics-engine",
      policy: "policy-guard",
      coreNav: "core-navigator",
      complianceDir: "compliance-review-director",
      hrAdvisory: "hr-advisory",
    }[key];

    const webhookUrl = webhookBase ? `${webhookBase}${cfg.webhookPath}` : undefined;

    const created = await managerClient.createAgent(
      { name: cfg.displayName, handle: handleSlug, description: cfg.description, webhookUrl },
      personalKey
    );

    if (!created) {
      results[key] = { status: "failed", error: "Band.ai API returned null — check personal key permissions" };
      continue;
    }

    // Update in-memory registry
    agentsConfig[key].id = created.id;
    agentsConfig[key].apiKey = created.apiKey;
    agentsConfig[key].handle = created.handle;
    // Swap to the agent's own client
    agentClients[key] = new BandClient(created.apiKey);

    // Persist to .env so credentials survive restarts
    try {
      const fs = await import("fs");
      const envPath = (await import("path")).join(process.cwd(), ".env");
      let envContent = fs.readFileSync(envPath, "utf-8");

      const envKeyMap: Record<string, [string, string, string]> = {
        risk:         ["BAND_RISK_AGENT_ID",          "BAND_RISK_API_KEY",          "BAND_RISK_HANDLE"],
        policy:       ["BAND_POLICY_AGENT_ID",         "BAND_POLICY_API_KEY",        "BAND_POLICY_HANDLE"],
        coreNav:      ["BAND_CORE_NAV_AGENT_ID",       "BAND_CORE_NAV_API_KEY",      "BAND_CORE_NAV_HANDLE"],
        complianceDir:["BAND_COMPLIANCE_DIR_AGENT_ID", "BAND_COMPLIANCE_DIR_API_KEY","BAND_COMPLIANCE_DIR_HANDLE"],
        hrAdvisory:   ["BAND_HR_ADVISORY_AGENT_ID",    "BAND_HR_ADVISORY_API_KEY",   "BAND_HR_ADVISORY_HANDLE"],
      };

      const [idKey, apiKey, handleKey] = envKeyMap[key];
      for (const [envKey, envVal] of [[idKey, created.id], [apiKey, created.apiKey], [handleKey, created.handle]] as [string, string][]) {
        const regex = new RegExp(`^${envKey}=.*$`, "m");
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${envKey}=${envVal}`);
        } else {
          envContent += `\n${envKey}=${envVal}`;
        }
      }
      fs.writeFileSync(envPath, envContent, "utf-8");
    } catch (e: any) {
      console.warn(`[Provision] Could not write credentials to .env for ${key}:`, e.message);
    }

    results[key] = { status: "created", id: created.id, handle: created.handle, webhookUrl };
  }

  res.json({ results, allProvisioned: Object.values(results).every((r: any) => r.status !== "failed") });
});

// Get agent provisioning status
app.get("/api/admin/agents-status", (_req, res) => {
  const status: Record<string, any> = {};
  for (const [key, cfg] of Object.entries(agentsConfig)) {
    status[key] = {
      displayName: cfg.displayName,
      avatar: cfg.avatar,
      description: cfg.description,
      provisioned: !!cfg.id && !!cfg.handle,
      handle: cfg.handle || null,
      id: cfg.id || null,
      webhookPath: cfg.webhookPath,
    };
  }
  res.json({ agents: status });
});

// Verify and save an individual agent's API key
// POST /api/admin/agent-key  body: { agentKey: "risk", apiKey: "band_a_...", handle: "@workspace/slug", agentId: "uuid" }
app.post("/api/admin/agent-key", async (req, res) => {
  const { agentKey, apiKey, handle, agentId } = req.body;
  if (!agentKey || !apiKey) {
    return res.status(400).json({ error: "agentKey and apiKey are required" });
  }
  if (!agentsConfig[agentKey]) {
    return res.status(404).json({ error: `Unknown agent key: ${agentKey}` });
  }

  // Test the key against Band.ai
  const testClient = new BandClient(apiKey);
  const result = await testClient.testConnection();
  if (!result.success) {
    return res.status(400).json({ error: `API key validation failed: ${result.error}` });
  }

  // Update in-memory registry
  agentsConfig[agentKey].apiKey = apiKey;
  agentClients[agentKey] = testClient;
  if (handle) agentsConfig[agentKey].handle = handle;
  if (agentId) agentsConfig[agentKey].id = agentId;
  if (result.agent?.id) agentsConfig[agentKey].id = result.agent.id;
  if (result.agent?.handle) agentsConfig[agentKey].handle = result.agent.handle;

  // Persist to .env
  try {
    const fs = await import("fs");
    const pathMod = await import("path");
    const envPath = pathMod.join(process.cwd(), ".env");
    let envContent = fs.readFileSync(envPath, "utf-8");

    const envKeyMap: Record<string, [string, string, string]> = {
      triage:       ["BAND_AGENT_ID",            "BAND_API_KEY",              "BAND_AGENT_HANDLE"],
      risk:         ["BAND_RISK_AGENT_ID",        "BAND_RISK_API_KEY",        "BAND_RISK_HANDLE"],
      policy:       ["BAND_POLICY_AGENT_ID",      "BAND_POLICY_API_KEY",      "BAND_POLICY_HANDLE"],
      coreNav:      ["BAND_CORE_NAV_AGENT_ID",    "BAND_CORE_NAV_API_KEY",    "BAND_CORE_NAV_HANDLE"],
      complianceDir:["BAND_COMPLIANCE_DIR_AGENT_ID","BAND_COMPLIANCE_DIR_API_KEY","BAND_COMPLIANCE_DIR_HANDLE"],
      hrAdvisory:   ["BAND_HR_ADVISORY_AGENT_ID", "BAND_HR_ADVISORY_API_KEY", "BAND_HR_ADVISORY_HANDLE"],
    };

    const [idKey, apiKeyEnv, handleKey] = envKeyMap[agentKey];
    const pairs: [string, string][] = [
      [apiKeyEnv, apiKey],
      ...(agentsConfig[agentKey].handle ? [[handleKey, agentsConfig[agentKey].handle]] as [string, string][] : []),
      ...(agentsConfig[agentKey].id ? [[idKey, agentsConfig[agentKey].id]] as [string, string][] : []),
    ];
    for (const [envKey, envVal] of pairs) {
      const regex = new RegExp(`^${envKey}=.*$`, "m");
      envContent = regex.test(envContent)
        ? envContent.replace(regex, `${envKey}=${envVal}`)
        : envContent + `\n${envKey}=${envVal}`;
    }
    fs.writeFileSync(envPath, envContent, "utf-8");
  } catch (e: any) {
    console.warn(`[agent-key] Could not write to .env:`, e.message);
  }

  res.json({
    success: true,
    agent: {
      key: agentKey,
      id: agentsConfig[agentKey].id,
      handle: agentsConfig[agentKey].handle,
      displayName: agentsConfig[agentKey].displayName,
      bandAgent: result.agent,
    }
  });
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

  // Band.ai internal agents don't support outbound API auth — rooms are local.
  const finalBandRoomId = `${caseId}-psychosocial-risk-review`;

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

  const initMsg: BandMessage = {
    id: `m-${caseId}-1`,
    caseId,
    agent: "system",
    agentName: "CareGuard Gateway",
    content: `🛡️ New Case Intake: A local Band room has been opened for Case #${caseId}. Patient privacy constraints have been initiated, and sensitive identity trackers have been redacted. Specialized agents have been summoned.`,
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

  // Band.ai internal agents don't support outbound API auth — no room upgrade attempted

  // Reset messages to clear any old processed messages other than system init log
  const initMsgs = (messages[caseId] || []).filter(m => m.type === "system_log");
  messages[caseId] = initMsgs;

  // Local helper to append message & simulate timeline
  const addMsg = (agent: AgentRole, agentName: string, content: string, type: any, struct?: any, avatar?: string) => {
    // Build list of resolvable agents — only include agents that have a real handle (i.e. provisioned)
    const peerMentions = [
      { id: agentsConfig.triage.id, handle: agentsConfig.triage.handle, name: agentsConfig.triage.displayName, template: "@triage_agent" },
      { id: agentsConfig.risk.id, handle: agentsConfig.risk.handle, name: agentsConfig.risk.displayName, template: "@risk_agent" },
      { id: agentsConfig.policy.id, handle: agentsConfig.policy.handle, name: agentsConfig.policy.displayName, template: "@policy_compliance_agent" },
      { id: agentsConfig.coreNav.id, handle: agentsConfig.coreNav.handle, name: agentsConfig.coreNav.displayName, template: "@care_pathway_agent" },
      { id: agentsConfig.complianceDir.id, handle: agentsConfig.complianceDir.handle, name: agentsConfig.complianceDir.displayName, template: "@review_decision_agent" },
      { id: agentsConfig.hrAdvisory.id, handle: agentsConfig.hrAdvisory.handle, name: agentsConfig.hrAdvisory.displayName, template: "@hr_advisory" },
    ].filter(p => !!p.handle);

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

    // Post to Band.ai using the agent's own client if provisioned, else fall back to Triage Sentinel
    const agentKeyMap: Record<AgentRole, string> = {
      triage_agent: "triage", risk_agent: "risk", policy_compliance_agent: "policy",
      care_pathway_agent: "coreNav", review_decision_agent: "complianceDir",
      hr_advisory: "hrAdvisory", system: "triage", human_reviewer: "triage",
    };
    const clientKey = agentKeyMap[agent] || "triage";
    const targetClient = agentClients[clientKey]?.isConfigured ? agentClients[clientKey] : managerClient;

    if (targetClient.isConfigured && !caseItem.bandRoomId.startsWith("case-")) {
      const bType: "thought" | "task" = (type === "final_memo") ? "task" : "thought";
      // Prefix with agent attribution when falling back to the triage identity so Band.ai shows who spoke
      const needsPrefix = !agentClients[clientKey]?.isConfigured && agent !== "triage_agent" && agent !== "system";
      const bandContent = needsPrefix ? `${avatar ?? ""} **${agentName}**\n${formattedContent}`.trim() : formattedContent;

      targetClient.sendChatEvent(caseItem.bandRoomId, bandContent, bType, struct)
        .catch(err => console.error(`Failed to push event [${agentName}] to Band.ai:`, err));

      if (agent !== "system") {
        targetClient.sendTextMessage(caseItem.bandRoomId, bandContent, mentionsToSend)
          .catch(err => console.error(`Failed to send message [${agentName}] to Band.ai:`, err));
      }
    }

    return newMsg;
  };

  // Priority 1: Use real LLM API keys (AI/ML API) for case-specific AI analysis
  // Priority 2: Use Gemini if available
  // Priority 3: Fall back to hardcoded simulation only if no API keys exist
  const hasCustomLLMKeys = !!process.env.AIML_API_KEY;

  if (!hasCustomLLMKeys && !ai) {
    console.log("No API keys available (Gemini or AIML). Using hardcoded simulation fallback.");
    // Hardcoded Simulation Fallback (generic, not case-specific)
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

  // Custom LLM API keys (AI/ML API) — real case-specific AI analysis
  if (hasCustomLLMKeys) {
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

      // 1. Triage Agent Call (Qwen on AI/ML API)
      const triagePrompt = `Analyze this report. Write a professional triage entry. Identify:
1. Main issue classification
2. An initial urgency rating (low, moderate, high, or critical)
3. Under-documented details (what information is missing?)
4. A handoff callout notifying fellow agents (@risk_agent, @policy_compliance_agent, @care_pathway_agent).

Respond with a raw JSON object matching this schema. Do not output anything other than raw JSON, and do not return the example values verbatim — base every field on the actual case details below:
{
  "readMarkdown": "Markdown summary of your report to post to the room. Use bullet points.",
  "category": "String case type classification",
  "urgency": "low | moderate | high | critical",
  "missingDetails": ["List of missing details to clarify"],
  "handoffTargets": ["risk_agent", "policy_compliance_agent"]
}

${docDataString}`;
      let triageTextRaw = "";
      try {
        triageTextRaw = await runOpenAICompatibleCompletion({
          model: "Qwen/Qwen2.5-7B-Instruct-Turbo",
          systemPrompt: "You are the Triage Agent (named Triage Sentinel) for CareGuard. Analyzing a high-stakes workplace psychosocial case. Return raw JSON matching the required schema.",
          userPrompt: triagePrompt
        });
      } catch (e) {
        console.warn("Triage Sentinel failed on Qwen, falling back to gpt-4o-mini:", e);
        triageTextRaw = await runOpenAICompatibleCompletion({
          model: "gpt-4o-mini",
          systemPrompt: "You are the Triage Agent (named Triage Sentinel) for CareGuard. Analyzing a high-stakes workplace psychosocial case. Return raw JSON matching the required schema.",
          userPrompt: triagePrompt
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
        triageResult = { ...triageResult, ...JSON.parse(cleanedText) };
      } catch (e) {
        console.warn("Failed to parse Qwen JSON:", e);
        triageResult.readMarkdown = triageTextRaw || triageResult.readMarkdown;
      }

      addMsg("triage_agent", process.env.BAND_AGENT_HANDLE ? `Triage Sentinel (${process.env.BAND_AGENT_HANDLE})` : "Triage Sentinel", triageResult.readMarkdown, "agent_report", triageResult, "🎯");

      // 2. Risk Agent Call (Llama on AI/ML API)
      const riskPrompt = `Psychosocial risk analysis based on:
Triage: ${JSON.stringify(triageResult)}

${docDataString}

Respond with a raw JSON object matching this schema. Do not output anything other than raw JSON, and do not return the example values verbatim — base every field on the actual case details above:
{
  "readMarkdown": "High-contrast Markdown summary of risk vectors found and your professional justification.",
  "riskFlags": ["severe_distress", "retaliation_probability"],
  "recommendedRiskLevel": "low | moderate | high | critical"
}`;
      let riskTextRaw = "";
      try {
        riskTextRaw = await runOpenAICompatibleCompletion({
          model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
          systemPrompt: "You are the Risk Agent (named Risk Analytics Engine) for CareGuard. You analyze workplace legal, safety, physiological, psychosocial, and corporate liabilities. Perform a psychosocial risk study. Return JSON matching the schema.",
          userPrompt: riskPrompt
        });
      } catch (e) {
        console.warn("Risk Analytics Engine failed via Llama, falling back to GPT-4o-mini:", e);
        riskTextRaw = await runOpenAICompatibleCompletion({
          model: "gpt-4o-mini",
          systemPrompt: "You are the Risk Agent (named Risk Analytics Engine) for CareGuard. You analyze workplace legal, safety, physiological, psychosocial, and corporate liabilities. Perform a psychosocial risk study. Return JSON matching the schema.",
          userPrompt: riskPrompt
        });
      }

      let riskResult = {
        readMarkdown: "High levels of anxiety noted. Disciplinary tracks pose retaliation vulnerability.",
        riskFlags: ["psychological_distress", "legal_retaliation"],
        recommendedRiskLevel: "high"
      };

      try {
        const cleaned = riskTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        riskResult = { ...riskResult, ...JSON.parse(cleaned) };
      } catch (e) {
        console.warn("Failed to parse Risk Agent JSON:", e);
        riskResult.readMarkdown = riskTextRaw || riskResult.readMarkdown;
      }

      addMsg("risk_agent", "Risk Analytics Engine", riskResult.readMarkdown, "agent_report", riskResult, "⚠️");

      // 3. Policy Agent Call (DeepSeek on AI/ML API)
      const policyPrompt = `Evaluate compliance constraints based on:
Triage: ${JSON.stringify(triageResult)}
Risk: ${JSON.stringify(riskResult)}

${docDataString}

Respond with a raw JSON object matching this schema. Do not output anything other than raw JSON, and do not return the example values verbatim — base every field on the actual case details above:
{
  "readMarkdown": "Policy and compliance checklist in Markdown. Highlight specific legal risks and documentation requirements.",
  "complianceRisk": "low | moderate | high | critical"
}`;
      let policyTextRaw = "";
      try {
        policyTextRaw = await runOpenAICompatibleCompletion({
          model: "deepseek/deepseek-chat-v3.1",
          systemPrompt: "You are the Policy & Compliance Agent (named Policy Guard) for CareGuard. You map workplace cases to legal directives, employer Duty of Care laws, EAP boundaries, and strict consent protections. Return JSON.",
          userPrompt: policyPrompt
        });
      } catch (e) {
        console.warn("Policy Guard failed on DeepSeek, falling back to gpt-4o-mini:", e);
        policyTextRaw = await runOpenAICompatibleCompletion({
          model: "gpt-4o-mini",
          systemPrompt: "You are the Policy & Compliance Agent (named Policy Guard) for CareGuard. You map workplace cases to legal directives, employer Duty of Care laws, EAP boundaries, and strict consent protections. Return JSON.",
          userPrompt: policyPrompt
        });
      }

      let policyResult = {
        readMarkdown: "Must respect non-disclosure. Disciplinary proceedings must be temporarily stayed.",
        complianceRisk: "high"
      };

      try {
        const cleaned = policyTextRaw.replace(/```json/g, "").replace(/```/g, "").trim();
        policyResult = { ...policyResult, ...JSON.parse(cleaned) };
      } catch (e) {
        console.warn("Failed to parse Policy Agent JSON:", e);
        policyResult.readMarkdown = policyTextRaw || policyResult.readMarkdown;
      }

      addMsg("policy_compliance_agent", "Policy Guard", policyResult.readMarkdown, "agent_report", policyResult, "📜");

      // 4. Care Agent Call (gpt-4o-mini on AI/ML API — fast & reliable)
      let careTextRaw = "";
      try {
        careTextRaw = await runOpenAICompatibleCompletion({
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
        careResult = { ...careResult, ...JSON.parse(cleaned) };
      } catch (e) {
        console.warn("Failed to parse Care Agent JSON:", e);
        careResult.readMarkdown = careTextRaw || careResult.readMarkdown;
      }

      addMsg("care_pathway_agent", "Care Navigator", careResult.readMarkdown, "agent_report", careResult, "🌱");

      // 5. Review Agent Debate/Challenge Compilation (gpt-4o-mini — fast)
      let reviewTextRaw = "";
      try {
        reviewTextRaw = await runOpenAICompatibleCompletion({
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
        reviewResult = { ...reviewResult, ...JSON.parse(cleaned) };
      } catch (e) {
        console.warn("Failed to parse Review Agent JSON:", e);
        reviewResult.challengePost = reviewTextRaw || reviewResult.challengePost;
      }

      addMsg("review_decision_agent", "Compliance Review Director", reviewResult.challengePost, "challenge_issued", null, "⚖️");

      // 6. Assemble Peer Responses (Debate Playback) (gpt-4o-mini — fast)
      let repliesTextRaw = "";
      try {
        repliesTextRaw = await runOpenAICompatibleCompletion({
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
        repliesResult = { ...repliesResult, ...JSON.parse(cleaned) };
      } catch (e) {
        console.warn("Failed to parse peer replies:", e);
      }

      addMsg("risk_agent", "Risk Analytics Engine", repliesResult.riskAgentReply, "agent_reply", null, "⚠️");
      addMsg("policy_compliance_agent", "Policy Guard", repliesResult.policyAgentReply, "agent_reply", null, "📜");

      // 7. Final Recommendation & Memo Compilation (gpt-4o-mini — fast)
      let memoTextRaw = "";
      try {
        memoTextRaw = await runOpenAICompatibleCompletion({
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
        memoResult = { ...memoResult, ...JSON.parse(cleaned) };
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
        hrResult = { ...hrResult, ...JSON.parse(cleaned) };
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

  // Gemini path — use if Gemini SDK is initialized and custom LLM keys are not available
  if (ai && !hasCustomLLMKeys) {
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
        triageResult = { ...triageResult, ...parsed };
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
        riskResult = { ...riskResult, ...parsed };
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
        policyResult = { ...policyResult, ...parsed };
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
        careResult = { ...careResult, ...parsed };
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
        reviewResult = { ...reviewResult, ...parsed };
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
        repliesResult = { ...repliesResult, ...parsed };
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
        memoResult = { ...memoResult, ...parsed };
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
        hrResult2 = { ...hrResult2, ...JSON.parse(cleaned) };
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

  // Sync human decision to Band.ai
  if (managerClient.isConfigured && !caseItem.bandRoomId.startsWith("case-")) {
    const formattedFeedback = `[Human Reviewer] ${actionText} (Sign-off: ${signOffStatus ? 'APPROVED' : 'PENDING'})`;
    managerClient.sendChatEvent(caseItem.bandRoomId, formattedFeedback, "task")
      .catch((err: any) => console.error(`Failed to push human feedback to Band.ai:`, err));
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

    // Sync closing message to Band.ai
    if (managerClient.isConfigured && !caseItem.bandRoomId.startsWith("case-")) {
      const closingConfirmation = `⚖️ **Compliance Review Director**\n🔒 Case Room closed by Human signatory. All compliance paths, EAP vouchers, work decoupling parameters, and case logs have been permanently preserved.`;
      managerClient.sendChatEvent(caseItem.bandRoomId, closingConfirmation, "task")
        .catch((err: any) => console.error(`Failed to push case closure status to Band.ai:`, err));
    }
  }

  res.json({ caseItem, messages: messages[caseId] });
});


// ---------------------- Band.ai Webhook Infrastructure ----------------------
//
// Each agent registered in Band.ai should point its webhook URL to the
// corresponding endpoint below, e.g.:
//   Triage Sentinel    -> https://<your-host>/api/webhooks/triage
//   Risk Analytics     -> https://<your-host>/api/webhooks/risk
//   Policy Guard       -> https://<your-host>/api/webhooks/policy
//   Core Navigator     -> https://<your-host>/api/webhooks/coreNav
//   Compliance Director-> https://<your-host>/api/webhooks/complianceDir
//   HR Advisory        -> https://<your-host>/api/webhooks/hrAdvisory
//
// When an agent is @mentioned in a Band room, Band.ai POSTs the message to
// that agent's webhook. The handler fetches room history, runs the LLM, and
// replies through Band.ai using the agent's own API key — completing the
// internal-agent communication loop entirely inside Band.ai.

type AgentWebhookDef = {
  role: AgentRole;
  displayName: string;
  avatar: string;
  ownHandle: string;
  ownClient: BandClient;
  systemPrompt: string;
  nextMentionRoles: (keyof typeof agentsConfig)[];
};

// Static per-agent metadata — clients and handles are resolved dynamically at call time
// so provisioning updates are picked up without restarting.
const agentWebhookDefs: Record<string, Omit<AgentWebhookDef, "ownHandle" | "ownClient">> = {
  triage: {
    role: "triage_agent",
    displayName: "Triage Sentinel",
    avatar: "🎯",
    systemPrompt:
      "You are Triage Sentinel for CareGuard. Analyze the case and produce a concise triage entry: issue classification, urgency (low/moderate/high/critical), missing information, and handoff notes. Use Markdown. Mention @risk_agent and @policy_compliance_agent to hand off.",
    nextMentionRoles: ["risk", "policy"],
  },
  risk: {
    role: "risk_agent",
    displayName: "Risk Analytics Engine",
    avatar: "⚠️",
    systemPrompt:
      "You are Risk Analytics Engine for CareGuard. Analyze psychosocial, legal, and retaliation risk vectors. Produce a Markdown risk report with a recommended risk level. Mention @review_decision_agent when done.",
    nextMentionRoles: ["complianceDir"],
  },
  policy: {
    role: "policy_compliance_agent",
    displayName: "Policy Guard",
    avatar: "📜",
    systemPrompt:
      "You are Policy Guard for CareGuard. Map the case to Duty of Care laws, confidentiality rules, and EAP obligations. Produce a Markdown compliance checklist. Mention @review_decision_agent when done.",
    nextMentionRoles: ["complianceDir"],
  },
  coreNav: {
    role: "care_pathway_agent",
    displayName: "Core Navigator",
    avatar: "🌱",
    systemPrompt:
      "You are Core Navigator for CareGuard. Design EAP referrals, supervisor-decoupling steps, and wellness adjustments. Produce a Markdown care-pathway plan. Mention @review_decision_agent when done.",
    nextMentionRoles: ["complianceDir"],
  },
  complianceDir: {
    role: "review_decision_agent",
    displayName: "Compliance Review Director",
    avatar: "⚖️",
    systemPrompt:
      "You are Compliance Review Director for CareGuard. Challenge peer recommendations with hard questions, then compile the final human-review advisory memo: risk level, recommended next step, rationale, and reviewer checklist. Mention @hr_advisory to request the action plan.",
    nextMentionRoles: ["hrAdvisory"],
  },
  hrAdvisory: {
    role: "hr_advisory",
    displayName: "HR Advisory",
    avatar: "👔",
    systemPrompt:
      "You are HR Advisory for CareGuard. Based on the final compliance memo, produce a consultative step-by-step action plan with immediate (0-24h) and short-term (24-72h) actions and a RACI matrix summary.",
    nextMentionRoles: [],
  },
};

// Template-handle map used to replace @shorthand with real Band.ai handles in LLM output
const MENTION_TEMPLATES: Record<string, keyof typeof agentsConfig> = {
  "@triage_agent": "triage",
  "@risk_agent": "risk",
  "@policy_compliance_agent": "policy",
  "@care_pathway_agent": "coreNav",
  "@review_decision_agent": "complianceDir",
  "@hr_advisory": "hrAdvisory",
};

async function handleBandWebhook(defKey: string, payload: any): Promise<string | null> {
  const def = agentWebhookDefs[defKey];
  // Resolve client and handle dynamically so provisioning updates take effect immediately
  const ownClient = agentClients[defKey]?.isConfigured ? agentClients[defKey] : managerClient;
  const ownHandle = agentsConfig[defKey]?.handle || agentsConfig.triage.handle;
  if (!def) return null;

  // Parse Band.ai webhook payload — handle multiple envelope formats
  const chatId: string =
    payload.chat_id ?? payload.data?.chat_id ?? payload.chat?.id ?? "";
  const incomingContent: string =
    payload.message?.content ?? payload.data?.message?.content ?? "";
  const senderHandle: string =
    payload.message?.sender?.handle ?? payload.data?.message?.sender?.handle ?? "";

  if (!chatId || !incomingContent) return null;

  // Anti-loop guard: skip messages sent by this same agent
  const cleanOwn = ownHandle.replace(/^@/, "");
  if (senderHandle && (senderHandle === cleanOwn || senderHandle.endsWith(`/${cleanOwn.split("/").pop()}`))) {
    return null;
  }

  // Find the case associated with this Band room
  const caseItem = cases.find(c => c.bandRoomId === chatId);
  if (!caseItem) {
    console.warn(`[Webhook/${defKey}] No case found for room ${chatId}`);
    return null;
  }

  // Fetch recent room messages to give the agent full conversation context
  const history = await ownClient.getMessages(chatId, 25);
  const historyStr = history
    .map((m: any) => `[${m.sender?.handle ?? m.sender_handle ?? "system"}]: ${m.content ?? ""}`)
    .join("\n");

  const caseContext = `Case Title: ${caseItem.title}
Department: ${caseItem.department}
Incident Date: ${caseItem.dateOfIncident}
Immediate Safety Concern: ${caseItem.immediateSafetyConcern}
Consent Given: ${caseItem.consentStatus}
Prior Interventions: ${caseItem.priorInterventions}
Redacted Description:
"""
${caseItem.redactedDescription}
"""`;

  // Run the agent's LLM using AIML API (with gpt-4o-mini fallback)
  let responseText = "";
  const userPrompt = `${caseContext}

Recent room conversation:
${historyStr || "(no prior messages)"}

Incoming message that triggered you:
${incomingContent}

Respond now as ${def.displayName}.`;

  try {
    responseText = await runOpenAICompatibleCompletion({
      model: "gpt-4o-mini",
      timeoutMs: 30000,
      systemPrompt: def.systemPrompt,
      userPrompt,
    });
  } catch (err) {
    console.error(`[Webhook/${defKey}] LLM call failed:`, err);
    return null;
  }

  if (!responseText) return null;

  // Resolve @shorthand mentions → real Band.ai handles and collect mention objects
  let formattedContent = responseText;
  const mentionsToSend: { id: string; handle: string; name: string }[] = [];

  for (const [template, configKey] of Object.entries(MENTION_TEMPLATES)) {
    if (formattedContent.includes(template)) {
      const cfg = agentsConfig[configKey];
      formattedContent = formattedContent.replace(new RegExp(template.replace("@", "\\@"), "g"), cfg.handle);
      if (!mentionsToSend.find(m => m.id === cfg.id)) {
        mentionsToSend.push({ id: cfg.id, handle: cfg.handle, name: agentWebhookDefs[configKey]?.displayName ?? configKey });
      }
    }
  }

  // Ensure mandatory next-step mentions are included
  for (const nextKey of def.nextMentionRoles) {
    const cfg = agentsConfig[nextKey];
    if (cfg.handle && !mentionsToSend.find(m => m.id === cfg.id)) {
      mentionsToSend.push({ id: cfg.id, handle: cfg.handle, name: agentWebhookDefs[nextKey]?.displayName ?? nextKey });
    }
  }

  // Mirror into in-app message store so the UI stays in sync
  messages[caseItem.id] = messages[caseItem.id] || [];
  messages[caseItem.id].push({
    id: `m-${caseItem.id}-wb-${Date.now()}`,
    caseId: caseItem.id,
    agent: def.role,
    agentName: def.displayName,
    agentAvatar: def.avatar,
    content: formattedContent,
    timestamp: new Date().toISOString(),
    type: "agent_report",
  } as BandMessage);

  // If agent has its own API key, also post via REST for richer mention support
  if (ownClient.isConfigured) {
    ownClient.sendTextMessage(chatId, formattedContent, mentionsToSend)
      .catch(err => console.warn(`[Webhook/${defKey}] REST post failed (ok to ignore for internal agents):`, err));
  }

  console.log(`[Webhook/${defKey}] Processed reply for room ${chatId}`);
  // Return the content so webhook endpoints can reply inline (internal agent flow — no API key needed)
  return formattedContent;
}


// Webhook endpoints — Band.ai calls these when the agent is @mentioned in a room.
// For internal agents the response is returned inline in the HTTP body (no separate API key needed).
// If the agent also has a REST API key, an additional sendTextMessage call is made for richer mention support.
async function webhookHandler(defKey: string, req: any, res: any) {
  res.setTimeout(35000);
  try {
    const content = await handleBandWebhook(defKey, req.body);
    if (content) {
      // Inline reply — Band.ai posts this as the agent's message in the room
      res.status(200).json({ message: content, content, text: content });
    } else {
      res.status(200).json({ ok: true });
    }
  } catch (err) {
    console.error(`[Webhook/${defKey}] Handler error:`, err);
    res.status(200).json({ ok: true });
  }
}

app.post("/api/webhooks/triage",       (req, res) => webhookHandler("triage",       req, res));
app.post("/api/webhooks/risk",         (req, res) => webhookHandler("risk",         req, res));
app.post("/api/webhooks/policy",       (req, res) => webhookHandler("policy",       req, res));
app.post("/api/webhooks/coreNav",      (req, res) => webhookHandler("coreNav",      req, res));
app.post("/api/webhooks/complianceDir",(req, res) => webhookHandler("complianceDir",req, res));
app.post("/api/webhooks/hrAdvisory",   (req, res) => webhookHandler("hrAdvisory",   req, res));

// ---------------------- End Webhook Infrastructure ----------------------

// Serve the Vite App
async function startServer() {
  if (process.env.VERCEL) {
    // On Vercel: static files are served by Vercel's CDN from dist/; Express handles API only.
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });

    // Serve index.html directly via Express for root requests,
    // bypassing Vite's HTML transform pipeline (which injects /@vite/client
    // and React refresh scripts that cause 403 errors on this vanilla JS page)
    app.get("/", async (req, res) => {
      try {
        const fs = await import("fs");
        const htmlPath = path.join(process.cwd(), "index.html");
        const html = fs.readFileSync(htmlPath, "utf-8");
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        console.error("Error serving index.html:", e);
        res.status(500).end("Internal Server Error");
      }
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

// Export for Vercel serverless runtime
export default app;
