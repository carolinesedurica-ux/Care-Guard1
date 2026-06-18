import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  CheckCircle,
  AlertTriangle,
  Plus,
  Search,
  UserCheck,
  RefreshCw,
  Lock,
  X,
  Zap,
  Bot,
  ExternalLink,
} from "lucide-react";
import { WorkplaceCase, BandMessage } from "./types";
import RiskGauge from "./components/RiskGauge";
import AgentStatusList from "./components/AgentStatusList";
import IntakeForm from "./components/IntakeForm";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [cases, setCases] = useState<WorkplaceCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<WorkplaceCase | null>(null);
  const [roomMessages, setRoomMessages] = useState<BandMessage[]>([]);
  const [isSubmittingIntake, setIsSubmittingIntake] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [bandConfig, setBandConfig] = useState<{ id: string | null; hasKey: boolean; handle: string | null } | null>(null);
  const [isTestingBand, setIsTestingBand] = useState(false);
  const [bandConnectionStatus, setBandConnectionStatus] = useState<{ checked: boolean; success: boolean; agentName?: string; error?: string } | null>(null);
  
  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("all");
  
  // Human Action Form State
  const [humanFeedback, setHumanFeedback] = useState("");
  const [signOffStatus, setSignOffStatus] = useState(false);
  const [checkedChecklistItems, setCheckedChecklistItems] = useState<Record<string, boolean>>({});

  // Error and Notification State
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Agent Provisioning Panel State
  const [showProvisionPanel, setShowProvisionPanel] = useState(false);
  const [agentsStatus, setAgentsStatus] = useState<Record<string, { provisioned: boolean; displayName: string; avatar: string; description: string; handle: string; webhookPath: string }>>({});
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [agentKeyInputs, setAgentKeyInputs] = useState<Record<string, string>>({});
  const [isVerifyingKey, setIsVerifyingKey] = useState<string | null>(null);

  // Fetch all cases on mount
  useEffect(() => {
    fetchCases();
    fetchConfig();
    fetchAgentsStatus();
  }, []);

  // Fetch active Case messages when selected case changes
  useEffect(() => {
    if (selectedCase) {
      fetchCaseDetails(selectedCase.id);
    }
  }, [selectedCase?.id]);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const fetchCases = async () => {
    try {
      const res = await fetch("/api/cases");
      if (res.ok) {
        const data = await res.json();
        setCases(data);
        if (data.length > 0 && !selectedCase) {
          setSelectedCase(data[0]);
        }
      } else {
        showNotification("error", "Failed to retrieve compliance records.");
      }
    } catch (err) {
      showNotification("error", "Error connecting to backend database server.");
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setBandConfig(data.bandAgent);
      }
    } catch (err) {
      console.error("Failed to fetch custom band configuration:", err);
    }
  };

  const fetchAgentsStatus = async () => {
    try {
      const res = await fetch("/api/admin/agents-status");
      if (res.ok) {
        const data = await res.json();
        setAgentsStatus(data.agents || {});
      }
    } catch (err) {
      console.error("Failed to fetch agents status:", err);
    }
  };

  const handleProvisionAgents = async () => {
    setIsProvisioning(true);
    try {
      const res = await fetch("/api/admin/provision-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookBaseUrl: window.location.origin }),
      });
      if (res.ok) {
        await fetchAgentsStatus();
        showNotification("success", "Webhook URLs updated for all provisioned agents.");
      } else {
        showNotification("error", "Failed to update webhook URLs. Check BAND_PERSONAL_API_KEY in .env.");
      }
    } catch (err) {
      showNotification("error", "Error connecting to provisioning service.");
    } finally {
      setIsProvisioning(false);
    }
  };

  const handleConnectAgentKey = async (agentKey: string) => {
    const apiKey = agentKeyInputs[agentKey]?.trim();
    if (!apiKey) return;
    setIsVerifyingKey(agentKey);
    try {
      const res = await fetch("/api/admin/agent-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentKey, apiKey }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showNotification("success", `${data.agent.displayName} connected: ${data.agent.handle || data.agent.bandAgent?.handle || "✓"}`);
        setExpandedAgent(null);
        setAgentKeyInputs(prev => { const n = { ...prev }; delete n[agentKey]; return n; });
        await fetchAgentsStatus();
      } else {
        showNotification("error", data.error || "Key verification failed — check that this is a valid band_a_... key.");
      }
    } catch {
      showNotification("error", "Error contacting server.");
    } finally {
      setIsVerifyingKey(null);
    }
  };

  const handleTestBandConnection = async () => {
    setIsTestingBand(true);
    try {
      const res = await fetch("/api/config/test-band", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setBandConnectionStatus({
            checked: true,
            success: true,
            agentName: data.agent?.name || "Connected Agent",
          });
          showNotification("success", `Successfully verified Band.ai protocol connection: ${data.agent?.name}`);
        } else {
          setBandConnectionStatus({
            checked: true,
            success: false,
            error: data.error || "Authentication rejected",
          });
          showNotification("error", `Band.ai authentication failed: ${data.error}`);
        }
      } else {
        showNotification("error", "Failed to contact local Band config service.");
      }
    } catch (err) {
      showNotification("error", "Error requesting Band.ai connection validation.");
    } finally {
      setIsTestingBand(false);
    }
  };

  const fetchCaseDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/cases/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedCase(data.caseItem);
        setRoomMessages(data.messages);
        
        // Reset checklist checkmark mappings for this case
        const initialChecks: Record<string, boolean> = {};
        if (data.caseItem.humanReviewerChecklist) {
          data.caseItem.humanReviewerChecklist.forEach((item: string) => {
            initialChecks[item] = false;
          });
        }
        setCheckedChecklistItems(initialChecks);
      }
    } catch (err) {
      console.error("Failed to load case details:", err);
    }
  };

  // 1. Submit Case Intake (Creates the redacted entry in backend)
  const handleIntakeSubmit = async (formData: any) => {
    setIsSubmittingIntake(true);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        const newCase = await res.json();
        setCases(prev => [newCase, ...prev]);
        setSelectedCase(newCase);
        setShowIntakeForm(false);
        showNotification("success", `Secure Room Opened for Case #${newCase.id}`);
      } else {
        showNotification("error", "Failed to compile intake safeguards.");
      }
    } catch (err) {
      showNotification("error", "Network timeout on redaction engine.");
    } finally {
      setIsSubmittingIntake(false);
    }
  };

  // 2. Trigger Multi-Agent Collaboration Session via Backend Gemini
  const handleTriggerReview = async () => {
    if (!selectedCase) return;
    setIsReviewing(true);
    showNotification("success", "Agents invited. Bootstrapping Band collaboration pipeline...");

    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/trigger-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedCase(data.caseItem);
        setRoomMessages(data.messages);

        if (data.bandSdkMode && data.bandRoomUrl) {
          showNotification("success", `Case posted to Band.ai. Agents are deliberating in the room — open it to follow along.`);
          window.open(data.bandRoomUrl, "_blank", "noopener");
        } else {
          showNotification("success", "Multi-Agent audit and consensus compiled successfully.");
        }

        // Update in cases cache
        setCases(prev => prev.map(c => c.id === data.caseItem.id ? data.caseItem : c));
      } else {
        const errData = await res.json();
        showNotification("error", errData.error || "Agent team consensus failed.");
      }
    } catch (err) {
      showNotification("error", "Critical error running multi-agent debate pipeline.");
    } finally {
      setIsReviewing(false);
    }
  };

  // 3. Post Human Action Feedback / Sign-off
  const handleHumanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !humanFeedback.trim()) return;

    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/human-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionText: humanFeedback,
          signOffStatus: signOffStatus
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSelectedCase(data.caseItem);
        setRoomMessages(data.messages);
        setHumanFeedback("");
        showNotification("success", signOffStatus ? "Case status finalized and archived!" : "Comment written to Band context.");
        
        // Update cases cache list
        setCases(prev => prev.map(c => c.id === data.caseItem.id ? data.caseItem : c));
      } else {
        showNotification("error", "Failed to commit decision log.");
      }
    } catch (err) {
      showNotification("error", "Error posting human decision.");
    }
  };

  const toggleChecklistItem = (item: string) => {
    setCheckedChecklistItems(prev => ({
      ...prev,
      [item]: !prev[item]
    }));
  };

  // Filter cases lists
  const filteredCases = cases.filter(c => {
    const matchesSearch = c.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          c.department.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDept = filterDepartment === "all" || c.department === filterDepartment;
    return matchesSearch && matchesDept;
  });

  // Calculate stats for top bar metrics
  const totalOpen = cases.length;
  const activeReviews = cases.filter(c => c.status === "completed" || c.status === "escalated_human").length;
  const pendingTriage = cases.filter(c => c.status === "triage_needed").length;

  // Custom visual labels for case status tags
  const getStatusLabel = (status: WorkplaceCase["status"]) => {
    switch (status) {
      case "draft": return { label: "Draft", class: "bg-gray-150 text-gray-700 border-gray-200" };
      case "triage_needed": return { label: "Awaiting Triage", class: "bg-amber-100 text-amber-800 border-amber-200 animate-pulse" };
      case "reviewing_agents": return { label: "Reviewing...", class: "bg-indigo-100 text-indigo-800 border-indigo-200" };
      case "completed": return { label: "Ready / Advisory Compiled", class: "bg-emerald-100 text-emerald-800 border-emerald-200" };
      case "escalated_human": return { label: "Sealed & Closed", class: "bg-gray-900 text-white border-transparent" };
      default: return { label: "Unknown", class: "bg-gray-100 text-gray-500 border-gray-150" };
    }
  };

  // Construct current Band Room structured state/context live JSON
  const getBandRoomStateJSON = () => {
    if (!selectedCase) return "{}";
    return JSON.stringify({
      case_id: selectedCase.id,
      case_type: "workplace_psychosocial_risk",
      source: "HR intake form",
      employee_identifiers_removed: selectedCase.description !== selectedCase.redactedDescription,
      risk_level: selectedCase.riskLevel || null,
      urgent_flags: selectedCase.urgentFlags || [],
      missing_information: selectedCase.missingInformation || [],
      requires_human_review: selectedCase.requiresHumanReview,
      status: selectedCase.status,
      signoff_sealed: selectedCase.status === "escalated_human"
    }, null, 2);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans select-none antialiased">
      {/* ⚠️ Notification banner */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg text-xs font-semibold flex items-center gap-2 border ${
              notification.type === "success" 
                ? "bg-emerald-600 text-white border-emerald-700" 
                : "bg-rose-600 text-white border-rose-700"
            }`}
          >
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Top Nav Header Bar - Professional Polish Edition */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 shadow-3xs z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center shrink-0 shadow-sm">
            <div className="w-4 h-4 bg-white rounded-sm"></div>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-800 flex items-center gap-1.5" id="brand-header">
              CareGuard
              <span className="text-indigo-600 font-semibold text-[10px] ml-1.5 border border-indigo-100 bg-indigo-50 px-2 py-0.5 rounded uppercase tracking-wider leading-none">
                Agentic Triage
              </span>
            </h1>
            <p className="text-[10px] text-slate-450 font-medium leading-none mt-0.5 max-xs:hidden">Multi-Agent Psychosocial Risk &amp; Compliance Room</p>
          </div>
        </div>

        {/* Global Dashboard Metrics */}
        <div className="hidden lg:flex items-center gap-6">
          <div className="text-right">
            <span className="block text-[9px] text-slate-400 uppercase tracking-widest font-semibold font-mono">Triage Directory</span>
            <span className="text-xs font-bold text-slate-700 font-mono">{totalOpen} Active Files</span>
          </div>
          <div className="h-6 w-px bg-slate-205" />
          <div className="text-right">
            <span className="block text-[9px] text-slate-400 uppercase tracking-widest font-semibold font-mono">Advisories Compiled</span>
            <span className="text-xs font-bold text-emerald-650 font-mono">{activeReviews} Sealed</span>
          </div>
          <div className="h-6 w-px bg-slate-205" />
          <div className="text-right">
            <span className="block text-[9px] text-slate-400 uppercase tracking-widest font-semibold font-mono">Pending Triage</span>
            <span className="text-xs font-bold text-amber-650 font-mono">{pendingTriage} Urgent</span>
          </div>
        </div>

        {/* System API Integration Status Badge and User Profile Context */}
        <div className="flex items-center gap-2.5">
          {/* Gemini Engine Indicator */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg shadow-3xs">
            <span className={`w-1.5 h-1.5 rounded-full ${bandConfig?.hasGemini ? 'bg-indigo-500 animate-pulse' : 'bg-amber-500'}`} />
            <span className="text-[9px] font-bold font-mono text-slate-600 uppercase tracking-wider">
              {bandConfig?.hasGemini ? "GEMINI LIVE" : "SIMULATED ENGINES"}
            </span>
          </div>

          {/* Band.ai Platform Protocol Connector */}
          {bandConfig ? (
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg shadow-3xs">
              {bandConfig.hasKey ? (
                <>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    bandConnectionStatus?.success 
                      ? "bg-emerald-500 animate-pulse" 
                      : bandConnectionStatus?.success === false 
                        ? "bg-red-500" 
                        : "bg-blue-500"
                  }`} />
                  <span className="text-[9px] font-bold font-mono text-slate-600 uppercase tracking-wide">
                    {bandConnectionStatus?.success 
                      ? `BAND: ${bandConnectionStatus.agentName || "CONNECTED"}`
                      : bandConnectionStatus?.success === false 
                        ? "BAND: FAIL"
                        : "BAND: PROGRAMMATIC READY"
                    }
                  </span>
                  <button
                    id="verify-band-auth-btn"
                    onClick={handleTestBandConnection}
                    disabled={isTestingBand}
                    className="text-[8px] font-bold text-indigo-600 hover:text-indigo-800 underline uppercase tracking-wide cursor-pointer select-none leading-none border-l border-slate-200 pl-1.5 ml-0.5"
                  >
                    {isTestingBand ? "Verifying..." : "Verify Auth"}
                  </button>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span className="text-[9px] font-bold font-mono text-slate-500 uppercase tracking-wide">
                    BAND: LOCAL FALLBACK
                  </span>
                </>
              )}
            </div>
          ) : null}

          <button
            onClick={() => { setShowProvisionPanel(true); fetchAgentsStatus(); }}
            className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg shadow-3xs hover:bg-slate-100 transition-all"
            title="Setup Band.ai agents"
          >
            <Bot className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[9px] font-bold font-mono text-slate-600 uppercase tracking-wider hidden sm:block">Setup Agents</span>
          </button>

          <div className="w-8 h-8 rounded-full bg-slate-105 bg-slate-900 text-white flex items-center justify-center text-xs font-mono font-extrabold shadow-3xs cursor-default select-none border border-slate-800" title="Human Reviewer Context">
            HR
          </div>
        </div>
      </header>

      {/* Main Container Layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* Left Sidebar: Case Directory */}
        <aside className="w-full md:w-80 bg-white border-r border-slate-200 flex flex-col shrink-0" id="case-directory-sidebar">
          {/* Sidebar Top controls */}
          <div className="p-4 border-b border-slate-150 space-y-3 bg-slate-50/50">
            <button
              id="sidebar-new-case-btn"
              onClick={() => {
                setShowIntakeForm(prev => !prev);
              }}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-xs transition-all tracking-wide"
            >
              <Plus className="w-4 h-4" />
              Start New Incident Review
            </button>

            {/* Live Case Filter Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="sidebar-search-input"
                type="text"
                value={searchQuery}
                aria-label="Search cases"
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Cases, IDs, Units..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
              />
            </div>

            {/* Department Categorizers filter */}
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
              <span>Filter by Department:</span>
              <select
                id="sidebar-dept-filter"
                value={filterDepartment}
                aria-label="Filter by department"
                onChange={(e) => setFilterDepartment(e.target.value)}
                className="bg-transparent font-bold text-slate-700 focus:outline-none cursor-pointer text-xs"
              >
                <option value="all">All Units</option>
                <option value="Finance">Finance</option>
                <option value="Customer Operations">Support Ops</option>
                <option value="Engineering">Software Eng</option>
                <option value="Human Resources">HR Unit</option>
              </select>
            </div>
          </div>

          {/* Incident Cases Cards lists wrapper */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[250px] md:max-h-none">
            {filteredCases.length === 0 ? (
              <div className="text-center py-8 text-xs text-gray-400">
                No active psychosocial reviews found in department scope.
              </div>
            ) : (
              filteredCases.map((c) => {
                const isSelected = selectedCase?.id === c.id;
                const statusTag = getStatusLabel(c.status);
                let riskColorClass = "bg-gray-100 text-gray-600 border-gray-200";
                if (c.riskLevel === "critical") riskColorClass = "bg-purple-100 text-purple-800 border-purple-200";
                if (c.riskLevel === "high") riskColorClass = "bg-red-100 text-red-800 border-red-200";
                if (c.riskLevel === "moderate") riskColorClass = "bg-amber-100 text-amber-800 border-amber-200";
                if (c.riskLevel === "low") riskColorClass = "bg-emerald-100 text-emerald-800 border-emerald-200";

                return (
                  <button
                    key={c.id}
                    id={`case-item-${c.id}`}
                    onClick={() => {
                      setSelectedCase(c);
                      setShowIntakeForm(false);
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-all relative ${
                      isSelected 
                        ? "bg-slate-900 text-white border-transparent shadow-md before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-indigo-500 before:rounded-r" 
                        : "bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-3xs"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${isSelected ? "bg-white/10 text-slate-200" : "bg-slate-100 text-slate-500"}`}>
                        #{c.id}
                      </span>
                      <span className={`text-[9px] font-semibold border px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${isSelected ? "border-white/10 bg-white/5 text-white" : statusTag.class}`}>
                        {statusTag.label}
                      </span>
                    </div>

                    <h3 className={`text-xs font-bold leading-snug line-clamp-2 ${isSelected ? "text-white" : "text-slate-800"}`}>
                      {c.title}
                    </h3>

                    <div className="mt-2.5 flex items-center justify-between text-[10px] text-slate-405 font-medium">
                      <span>{c.department}</span>
                      {c.riskLevel ? (
                        <span className={`text-[9.5px] px-1.5 py-0.2 rounded border font-bold uppercase ${isSelected ? "bg-white/10 text-white border-transparent" : riskColorClass}`}>
                          {c.riskLevel} Risk
                        </span>
                      ) : (
                        <span className="italic text-[9.5px]">Awaiting analysis</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Main Triage Workspace Panel */}
        <main className="flex-1 flex flex-col overflow-y-auto md:overflow-hidden bg-gray-50">
          
          <AnimatePresence mode="wait">
            {showIntakeForm ? (
              // Form Overlap Animation View
              <motion.div
                key="intake-form-pane"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className="flex-1 p-6 overflow-y-auto max-w-2xl mx-auto w-full"
              >
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-bold text-gray-800">Launch New Regulated Workflow Room</h2>
                  <button 
                    id="close-intake-btn"
                    onClick={() => setShowIntakeForm(false)}
                    className="p-1 px-1.5 rounded-full border border-gray-200 hover:bg-gray-100"
                  >
                    <X className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                </div>
                <IntakeForm onSubmit={handleIntakeSubmit} isSubmitting={isSubmittingIntake} />
              </motion.div>
            ) : selectedCase ? (
              // Workspace Layout View
              <motion.div
                key="workspace-view"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col md:flex-row overflow-hidden h-full"
              >
                {/* Panel 1: Incident Description & Final Compliance Memo */}
                <div className="w-full md:w-1/2 border-b md:border-b-0 md:border-r border-slate-200 p-5 overflow-y-auto space-y-5">
                  
                  {/* Case Context Header Info */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-400">
                        Incident Compliance Directive
                      </span>
                      <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-full ${getStatusLabel(selectedCase.status).class}`}>
                        {getStatusLabel(selectedCase.status).label}
                      </span>
                    </div>

                    <h2 className="text-base font-extrabold text-slate-800 tracking-tight leading-snug">
                      {selectedCase.title}
                    </h2>

                    {/* Metadata grids */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider font-mono text-slate-400 font-bold">Department</span>
                        <strong className="text-slate-850 font-semibold">{selectedCase.department}</strong>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider font-mono text-slate-400 font-bold">Date Logged</span>
                        <strong className="text-slate-850 font-semibold">{selectedCase.dateOfIncident}</strong>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase tracking-wider font-mono text-slate-400 font-bold">Prior Interv.</span>
                        <strong className="text-slate-850 font-semibold block truncate" title={selectedCase.priorInterventions}>
                          {selectedCase.priorInterventions || "None"}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Redaction Integrity comparison card */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                    <div className="bg-[#1E293B] px-4 py-2.5 flex items-center justify-between text-white border-b border-indigo-900/10">
                      <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-slate-300">
                        Redaction Guard Integrity Module
                      </span>
                      <span className="text-[9px] bg-indigo-600 text-indigo-50 border border-indigo-500 font-semibold px-2 py-0.5 rounded font-mono uppercase tracking-wide">
                        Compliant
                      </span>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed">
                      <div>
                        <span className="font-bold text-slate-500 block mb-1.5 uppercase text-[9px] tracking-wide">Original Intake Log:</span>
                        <p className="bg-rose-50/40 p-2.5 rounded-lg border border-rose-100 text-slate-705 text-[11px] leading-relaxed select-text font-mono max-h-36 overflow-y-auto">
                          {selectedCase.description}
                        </p>
                      </div>
                      <div>
                        <span className="font-bold text-emerald-600 block mb-1.5 uppercase text-[9px] tracking-wide">Sanitized Audit Log (Visible to Agents):</span>
                        <p className="bg-emerald-50/40 p-2.5 rounded-lg border border-emerald-100/80 text-slate-705 text-[11px] leading-relaxed select-text font-mono max-h-36 overflow-y-auto">
                          {selectedCase.redactedDescription}
                        </p>
                      </div>
                    </div>
                    <div className="bg-slate-50 border-t border-slate-100 px-4 py-2.5 text-[9.5px] text-slate-400 leading-normal flex items-start gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>Security Standard: CareGuard isolates real person identifiers. All peer-agent discussion happens inside the Band workspace using ONLY the sanitized audit text.</span>
                    </div>
                  </div>

                  {/* 🏆 COMPLIANCE AND RISK ADVISORY MEMO PANEL */}
                  {selectedCase.status === "completed" || selectedCase.status === "escalated_human" ? (
                    <div className="space-y-4">
                      
                      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4 relative overflow-hidden">
                        
                        {/* Advisory watermark / badge */}
                        <div className="absolute top-0 right-0 translate-x-2 -translate-y-2 w-28 h-28 bg-gray-50 border border-gray-200/50 rounded-full flex items-center justify-center pointer-events-none opacity-20">
                          <span className="text-[9px] uppercase font-bold tracking-widest font-mono text-gray-600 rotate-45">CONSENSUS SEALED</span>
                        </div>

                        {/* Top layout dial & title */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                          <div className="sm:col-span-2 space-y-1">
                            <span className="text-[10px] bg-slate-900 text-white font-bold px-2 py-0.5 rounded font-mono uppercase tracking-widest">
                              Consensus Document
                            </span>
                            <h3 className="text-sm font-bold text-gray-900 tracking-tight flex items-center gap-1.5">
                              🏆 Compliance &amp; Psychosocial Risk Advisory
                            </h3>
                            <p className="text-[10px] text-gray-500 leading-relaxed font-mono">
                              UUID: CG-ADVISORY-{selectedCase.id.toUpperCase()}
                            </p>
                          </div>
                          <div className="flex justify-center">
                            <RiskGauge riskLevel={selectedCase.riskLevel} />
                          </div>
                        </div>

                        {/* Core Recommended recipe */}
                        <div className="bg-gray-900 text-white p-4 rounded-xl border border-gray-800 space-y-1">
                          <span className="text-[9px] uppercase tracking-widest font-semibold text-gray-400 font-mono block">Definitive Next Step Action Recipe</span>
                          <p className="text-xs font-bold leading-relaxed">
                            {selectedCase.finalRecommendation || (selectedCase.finalMemoCompiled?.recommendedNextStep)}
                          </p>
                        </div>

                        {/* Rationale Breakdown */}
                        {selectedCase.finalMemoCompiled?.rationale && (
                          <div className="space-y-2">
                            <span className="block text-xs font-bold text-gray-800">Organizational Impact &amp; Legal Rationale:</span>
                            <ul className="space-y-1.5">
                              {selectedCase.finalMemoCompiled.rationale.map((item, idx) => (
                                <li key={idx} className="flex items-start gap-1.5 text-xs text-gray-600 leading-relaxed">
                                  <span className="bg-gray-150 text-gray-800 font-bold px-1.5 py-0.2 rounded text-[9px] font-mono mt-0.5 shrink-0 select-none">
                                    0{idx+1}
                                  </span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Checklist - Interactive Section */}
                        {selectedCase.humanReviewerChecklist && selectedCase.humanReviewerChecklist.length > 0 && (
                          <div className="bg-indigo-900 rounded-xl p-5 shadow-sm text-white space-y-3 relative overflow-hidden">
                            <div className="absolute top-0 right-0 translate-x-4 -translate-y-4 w-32 h-32 bg-indigo-850/40 rounded-full pointer-events-none" />
                            <div className="flex items-center justify-between relative z-10">
                              <span className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest block">Human Reviewer Checklist</span>
                              <span className="text-[10px] text-indigo-300 font-mono bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-850/50">
                                {Object.values(checkedChecklistItems).filter(Boolean).length} of {selectedCase.humanReviewerChecklist.length} Approved
                              </span>
                            </div>
                            <div className="space-y-2 relative z-10">
                              {selectedCase.humanReviewerChecklist.map((item, idx) => {
                                const isChecked = checkedChecklistItems[item] || false;
                                return (
                                  <label 
                                    key={idx} 
                                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer select-none transition-all ${
                                      isChecked 
                                        ? "bg-indigo-800/80 border-indigo-500/50 text-white" 
                                        : "bg-indigo-950/40 border-indigo-900/50 text-indigo-100 hover:bg-indigo-950/60"
                                    }`}
                                  >
                                    <input 
                                      id={`checklist-item-${idx}`}
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => toggleChecklistItem(item)}
                                      className="mt-0.5 rounded border-indigo-800 text-indigo-600 focus:ring-indigo-500 focus:outline-none bg-transparent"
                                    />
                                    <span className="text-[11.5px] leading-snug">{item}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Sign-off Actions Forms */}
                        <form onSubmit={handleHumanSubmit} className="border-t border-slate-150 pt-4 space-y-3">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1" id="lbl-feedback">
                              Human Compliance Sign-Off Comments &amp; Notes
                            </label>
                            <textarea
                              id="human-comments-textarea"
                              rows={2}
                              value={humanFeedback}
                              onChange={(e) => setHumanFeedback(e.target.value)}
                              placeholder="Write case conclusion comments, witness logs, or EAP dispatch references here..."
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:ring-1 focus:ring-slate-750 focus:hover:border-slate-350 focus:outline-none leading-relaxed transition-shadow bg-slate-50/50 text-slate-800"
                              disabled={selectedCase.status === "escalated_human"}
                            />
                          </div>

                           {selectedCase.status !== "escalated_human" ? (
                            <div className="flex flex-col sm:flex-row items-center gap-3 justify-between bg-slate-50 p-3 rounded-lg border border-slate-150">
                              <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input 
                                  id="signoff-checkbox"
                                  type="checkbox"
                                  checked={signOffStatus}
                                  onChange={(e) => setSignOffStatus(e.target.checked)}
                                  className="rounded border-slate-300 text-indigo-605 focus:ring-indigo-500"
                                />
                                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                  <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                                  Approve Case and Sign-Off
                                </span>
                              </label>

                               <button
                                id="human-commit-btn"
                                type="submit"
                                className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 border border-transparent rounded-lg text-xs font-bold text-white shadow-xs tracking-wide transition-all"
                              >
                                {signOffStatus ? "🔐 Seal Room & Audit Trail" : "💬 Post Comment to Room"}
                              </button>
                            </div>
                          ) : (
                            <div className="p-3 bg-slate-100 text-slate-500 rounded-lg text-xs flex items-center justify-center gap-2 border border-slate-200 font-mono uppercase tracking-wide">
                              <Lock className="w-3.5 h-3.5 text-slate-400" />
                              Case Closed &amp; Certified
                            </div>
                          )}
                        </form>

                      </div>

                    </div>
                  ) : (
                    <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-5 text-center space-y-3">
                      <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto text-amber-600">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                      <div className="max-w-xs mx-auto">
                        <h4 className="text-xs font-bold text-amber-900">Multi-Agent Review Required</h4>
                        <p className="text-[11px] text-amber-700 leading-normal mt-1.5">
                          This case has not yet undergone specialized triage evaluation inside the compliance taskforce. Trigger the room agents to finalize risks.
                        </p>
                      </div>
                      <button
                        id="start-review-main-btn"
                        onClick={handleTriggerReview}
                        disabled={isReviewing}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 border border-transparent rounded-lg text-xs font-bold text-white shadow hover:bg-gray-850 active:scale-98 transition-all disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isReviewing ? 'animate-spin' : ''}`} />
                        {isReviewing ? "Invoking Roster Agents..." : "⚡ Trigger Multi-Agent Triage"}
                      </button>
                    </div>
                  )}

                </div>

                {/* Panel 2: Live Room Activity Ledger & Band State JSON */}
                <div className="w-full md:w-1/2 flex flex-col h-full overflow-hidden bg-white p-5 space-y-4">
                  
                  {/* Top Bar describing room and listing active taskforce */}
                  <div className="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="space-y-0.5">
                      <h3 className="text-xs font-extrabold text-slate-805 text-slate-800 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        {!selectedCase.bandRoomId.startsWith("case-") ? (
                          <a 
                            href={`https://app.band.ai/chats/${selectedCase.bandRoomId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline hover:text-indigo-600 flex items-center gap-1 font-mono text-[11px]"
                            title="Open this real room directly in your browser on the Band.ai platform!"
                          >
                            Room: #{selectedCase.bandRoomId.substring(0, 13)}... ↗
                          </a>
                        ) : (
                          <span>Room: #case-{selectedCase.id}-review</span>
                        )}
                      </h3>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {!selectedCase.bandRoomId.startsWith("case-") 
                          ? "✓ Active Remote Sync on Band.ai" 
                          : "Simulated off-network room context"
                        }
                      </p>
                    </div>

                    {selectedCase.status !== "completed" && selectedCase.status !== "escalated_human" && (
                      <button
                        id="re-triage-top-btn"
                        onClick={handleTriggerReview}
                        disabled={isReviewing}
                        className="flex items-center gap-1.5 bg-indigo-600 border border-transparent rounded-lg text-[10px] font-bold text-white px-3 py-1.5 hover:bg-indigo-500 transition-all shadow-xs"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isReviewing ? 'animate-spin' : ''}`} />
                        {isReviewing ? "Invoking..." : "⚡ Activate Taskforce"}
                      </button>
                    )}
                  </div>

                  {/* Multi-Agent Dynamic Status List */}
                  <div className="shrink-0">
                    <AgentStatusList activeMessages={roomMessages} isReviewing={isReviewing} customAgentInfo={bandConfig} />
                  </div>

                  {/* Splits lower half into Messages Stream on Left, and JSON Room State Panel on Right */}
                  <div className="flex-1 flex flex-col lg:flex-row overflow-hidden gap-4">
                    
                    {/* Messaging feed column */}
                    <div className="flex-1 flex flex-col h-full bg-slate-50/50 rounded-xl border border-slate-200 p-3 overflow-hidden">
                      <span className="text-[9px] uppercase font-bold tracking-wider font-mono text-slate-400 mb-2 block px-1">
                        Timeline &amp; Audit Logs
                      </span>

                      <div className="flex-1 overflow-y-auto space-y-3 px-1">
                        {roomMessages.map((m) => {
                          const isSys = m.agent === "system";
                          const isHuman = m.agent === "human_reviewer";
                          const isChallenge = m.type === "challenge_issued";
                          
                          // Custom style wrappers based on who posted
                          let cardClass = "bg-white border-slate-200";
                          let sideBorderColor = "border-l-indigo-600";
                          if (isSys) {
                            cardClass = "bg-slate-100 border-slate-205 text-slate-600 p-2.5 font-mono text-[10px] leading-relaxed";
                          } else if (isHuman) {
                            cardClass = "bg-emerald-50/40 border-emerald-200 text-slate-800";
                            sideBorderColor = "border-l-emerald-600";
                          } else if (isChallenge) {
                            cardClass = "bg-indigo-50/20 border-indigo-200 text-slate-800";
                            sideBorderColor = "border-l-indigo-500";
                          } else {
                            if (m.agent === "triage_agent") sideBorderColor = "border-l-sky-500";
                            if (m.agent === "risk_agent") sideBorderColor = "border-l-amber-500";
                            if (m.agent === "policy_compliance_agent") sideBorderColor = "border-l-rose-500";
                            if (m.agent === "care_pathway_agent") sideBorderColor = "border-l-teal-500";
                            if (m.agent === "review_decision_agent") sideBorderColor = "border-l-indigo-600";
                            if (m.agent === "hr_advisory") sideBorderColor = "border-l-violet-600";
                          }

                          return (
                            <div 
                              key={m.id} 
                              className={`p-3 rounded-lg border text-xs shadow-3xs transition-all text-slate-800 flex flex-col gap-1.5 ${cardClass} ${!isSys ? `border-l-3 ${sideBorderColor}` : ''}`}
                            >
                              {!isSys && (
                                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm shrink-0 leading-none">{m.agentAvatar || "👥"}</span>
                                    <span className="font-bold text-slate-800 font-sans tracking-tight text-[11px]">{m.agentName}</span>
                                    <span className="text-[8px] uppercase tracking-wider px-1.5 bg-slate-100 border border-slate-200/50 rounded text-slate-500 font-mono leading-none">
                                      {m.agent.replace(/_/g, " ")}
                                    </span>
                                  </div>
                                  <span className="text-[9px] font-mono text-slate-400">
                                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </span>
                                </div>
                              )}
                              <p className="whitespace-pre-wrap leading-relaxed text-[11.5px] text-slate-800 font-medium">
                                {m.content}
                              </p>
                            </div>
                          );
                        })}

                        {isReviewing && (
                          <div className="p-3 bg-white rounded-lg border border-slate-150 border-l-3 border-l-amber-500 flex items-center gap-2.5 text-xs text-slate-500 font-sans animate-pulse">
                            <span className="text-base shrink-0 leading-none">⚙️</span>
                            <span>The multi-agent consensus engine is currently reviewing records. Generating safe-harbor pathways and challenge logs...</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Band Room JSON-State panel column */}
                    <div className="hidden lg:flex w-60 flex-col bg-[#1E293B] rounded-xl border border-indigo-950 p-3 overflow-hidden shrink-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] uppercase font-bold tracking-widest font-mono text-slate-400">
                          Band State JSON
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-505 bg-emerald-500 animate-pulse" />
                          <span className="text-[8px] font-mono font-medium text-emerald-400 uppercase">SYNCED</span>
                        </div>
                      </div>

                      <pre className="flex-1 bg-slate-950 p-2.5 rounded-lg border border-slate-800 font-mono text-[9.5px] leading-normal text-emerald-400 overflow-auto select-text whitespace-pre-wrap">
                        {getBandRoomStateJSON()}
                      </pre>

                      <div className="text-[8.5px] text-slate-400 leading-normal font-mono border-t border-slate-800 pt-2 mt-2">
                        Band Room acts as a shared ledger context to exchange state between multi-framework agents seamlessly.
                      </div>
                    </div>

                  </div>

                </div>
              </motion.div>
            ) : (
              // Empty selection state fallback
              <div className="flex-1 flex items-center justify-center text-center p-6 bg-slate-50">
                <div className="max-w-xs space-y-3">
                  <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center mx-auto text-gray-500">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  </div>
                  <h4 className="text-xs font-bold text-gray-800">Seeding Database Records</h4>
                  <p className="text-[11px] text-gray-500 leading-normal">
                    Setting up standard psychosocial risk scenarios, redacting customer secrets. Please wait...
                  </p>
                </div>
              </div>
            )}
          </AnimatePresence>

        </main>
      </div>

      {/* Agent Provision Panel Drawer */}
      <AnimatePresence>
        {showProvisionPanel && (
          <>
            <motion.div
              key="provision-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowProvisionPanel(false)}
            />
            <motion.div
              key="provision-drawer"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-[420px] bg-white shadow-2xl border-l border-slate-200 flex flex-col"
            >
              {/* Drawer header */}
              <div className="p-5 border-b border-slate-700 flex items-center justify-between bg-slate-900 shrink-0">
                <div className="flex items-center gap-2.5">
                  <Bot className="w-5 h-5 text-indigo-400" />
                  <div>
                    <h2 className="text-sm font-bold text-white">Band.ai Agent Setup</h2>
                    <p className="text-[10px] text-slate-400 font-mono">Connect internal agents to CareGuard</p>
                  </div>
                </div>
                <button onClick={() => setShowProvisionPanel(false)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Step instructions */}
              <div className="px-4 pt-4 pb-3 bg-indigo-50 border-b border-indigo-100 shrink-0 space-y-2">
                <p className="text-[11px] font-bold text-indigo-800 uppercase tracking-wide">How to connect agents</p>
                <ol className="text-[11px] text-indigo-700 leading-relaxed space-y-1 list-none">
                  <li className="flex gap-2"><span className="font-bold text-indigo-500 shrink-0">1.</span>Go to <a href="https://app.band.ai/agents" target="_blank" rel="noopener noreferrer" className="underline font-semibold hover:text-indigo-900">app.band.ai/agents</a> and create each agent below</li>
                  <li className="flex gap-2"><span className="font-bold text-indigo-500 shrink-0">2.</span>Copy the <code className="bg-indigo-100 px-1 rounded font-mono">band_a_...</code> API key for each agent</li>
                  <li className="flex gap-2"><span className="font-bold text-indigo-500 shrink-0">3.</span>Expand the agent card below, paste the key, and click Connect</li>
                </ol>
              </div>

              {/* Agent list */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-slate-50">
                {Object.keys(agentsStatus).length === 0 ? (
                  <div className="text-center py-10 text-xs text-slate-400">
                    <Bot className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    Loading agent status...
                  </div>
                ) : (
                  (Object.entries(agentsStatus) as Array<[string, typeof agentsStatus[string]]>).map(([key, agent]) => {
                    const isExpanded = expandedAgent === key;
                    const inputVal = agentKeyInputs[key] || "";
                    const isVerifying = isVerifyingKey === key;
                    return (
                      <div key={key} className={`bg-white border rounded-xl shadow-xs overflow-hidden transition-all ${isExpanded ? "border-indigo-300" : "border-slate-200"}`}>
                        {/* Agent row */}
                        <button
                          onClick={() => setExpandedAgent(isExpanded ? null : key)}
                          className="w-full flex items-center justify-between p-3.5 text-left hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-xl leading-none shrink-0">{agent.avatar}</span>
                            <div>
                              <p className="text-xs font-bold text-slate-800">{agent.displayName}</p>
                              <p className="text-[10px] text-slate-400 font-mono">
                                {agent.handle || "No handle — not yet connected"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {agent.provisioned ? (
                              <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                                <CheckCircle className="w-3 h-3" /> Connected
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Needs Key
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Expanded form */}
                        {isExpanded && (
                          <div className="border-t border-slate-100 p-3.5 space-y-3 bg-slate-50/80">
                            <div className="text-[10px] text-slate-500 leading-relaxed">
                              <span className="font-semibold text-slate-700">Agent name to use on Band.ai:</span>{" "}
                              <span className="font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded">{agent.displayName}</span>
                            </div>
                            {agent.description && (
                              <p className="text-[10px] text-slate-500 italic leading-relaxed">{agent.description}</p>
                            )}
                            <div className="space-y-2">
                              <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wide">
                                Paste API Key (band_a_...)
                              </label>
                              <input
                                type="text"
                                value={inputVal}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAgentKeyInputs((prev: Record<string, string>) => ({ ...prev, [key]: e.target.value }))}
                                placeholder="band_a_1234_..."
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleConnectAgentKey(key)}
                                disabled={!inputVal || isVerifying}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                              >
                                <Zap className={`w-3 h-3 ${isVerifying ? "animate-pulse" : ""}`} />
                                {isVerifying ? "Verifying..." : "Verify & Connect"}
                              </button>
                              <a
                                href="https://app.band.ai/agents"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1.5 py-2 px-3 bg-white border border-slate-200 text-slate-600 rounded-lg text-[11px] font-semibold hover:bg-slate-50 transition-all"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Create
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Drawer footer */}
              <div className="p-4 border-t border-slate-200 space-y-2 bg-white shrink-0">
                <button
                  onClick={handleProvisionAgents}
                  disabled={isProvisioning}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold shadow transition-all disabled:opacity-50"
                >
                  <Zap className={`w-3.5 h-3.5 ${isProvisioning ? "animate-pulse" : ""}`} />
                  {isProvisioning ? "Updating..." : "Sync Webhook URLs"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Structured Footer */}
      <footer className="h-10 bg-[#0F172A] border-t border-slate-800 flex items-center justify-between px-6 shrink-0 text-[9px] text-slate-400 uppercase tracking-widest font-mono">
        <div>AUDIT TRAIL: B_NODE-8821-X992 // ROOM: CASE-TRIAGE-77</div>
        <div>CareGuard Regulatory Compliance Engine v1.0.4</div>
      </footer>
    </div>
  );
}
