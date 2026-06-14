import React, { useState } from "react";
import { PlusCircle, ShieldAlert, HeartHandshake, Landmark, UserMinus } from "lucide-react";

interface IntakeFormProps {
  onSubmit: (formData: any) => Promise<void>;
  isSubmitting: boolean;
}

export default function IntakeForm({ onSubmit, isSubmitting }: IntakeFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("Customer Operations");
  const [dateOfIncident, setDateOfIncident] = useState(new Date().toISOString().split('T')[0]);
  const [immediateSafetyConcern, setImmediateSafetyConcern] = useState<'yes' | 'no' | 'unknown'>("unknown");
  const [consentStatus, setConsentStatus] = useState(false);
  const [priorInterventions, setPriorInterventions] = useState("");
  const [policyCategory, setPolicyCategory] = useState("Psychosocial Risk / Workplace Stress");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Please provide a representative Title and full Incident Description.");
      return;
    }
    setError(null);
    await onSubmit({
      title,
      description,
      department,
      dateOfIncident,
      immediateSafetyConcern,
      consentStatus,
      priorInterventions,
      policyCategory
    });

    // Reset Form
    setTitle("");
    setDescription("");
    setImmediateSafetyConcern("unknown");
    setConsentStatus(false);
    setPriorInterventions("");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white p-5 rounded-xl border border-slate-200 shadow-3xs">
      <div className="flex items-center gap-2 mb-1 border-b border-slate-100 pb-3">
        <Landmark className="w-5 h-5 text-indigo-600" id="inc-icon" />
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800" id="intake-title">Workplace Psychosocial Intake</h2>
          <p className="text-[10px] text-slate-450 leading-none mt-0.5">Confidential non-repudiation file creation platform</p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 text-rose-700 rounded-lg text-xs font-semibold leading-relaxed border border-rose-100">
          {error}
        </div>
      )}

      {/* Title */}
      <div>
        <label className="block text-xs font-semibold text-slate-705 mb-1" id="lbl-title">
          Case Title &amp; Incident Abstract
        </label>
        <input
          id="intake-title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Operations Burnout and Communication Breakdown"
          className="w-full px-3 py-2 rounded-lg border border-slate-205 text-xs focus:ring-1 focus:ring-indigo-500 focus:hover:border-slate-355 focus:outline-none transition-all text-slate-800 bg-white"
          disabled={isSubmitting}
        />
      </div>

      {/* Split Department and Incident Date */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-705 mb-1" id="lbl-dept">
            Operational Unit
          </label>
          <select
            id="intake-dept-select"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-full px-2 py-2 rounded-lg border border-slate-205 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-medium text-slate-800 cursor-pointer"
            disabled={isSubmitting}
          >
            <option value="Customer Operations">Support Operations</option>
            <option value="Finance">Finance &amp; Treasury</option>
            <option value="Engineering">Software Engineering</option>
            <option value="Human Resources">Human Resources</option>
            <option value="Sales &amp; Marketing">Enterprise Sales</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-705 mb-1" id="lbl-date">
            Incident Date
          </label>
          <input
            id="intake-date-input"
            type="date"
            value={dateOfIncident}
            onChange={(e) => setDateOfIncident(e.target.value)}
            className="w-full px-2 py-2 rounded-lg border border-slate-205 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-medium text-slate-800 cursor-pointer animate-none"
            disabled={isSubmitting}
          />
        </div>
      </div>

      {/* Policy Category selection */}
      <div>
        <label className="block text-xs font-semibold text-slate-705 mb-1" id="lbl-policy">
          Internal Compliance Category
        </label>
        <select
          id="intake-policy-select"
          value={policyCategory}
          onChange={(e) => setPolicyCategory(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-205 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-medium text-slate-800 cursor-pointer"
          disabled={isSubmitting}
        >
          <option value="Psychosocial Risk / Workplace Stress">Psychosocial Risk / Conflict Resolution</option>
          <option value="Occupational Health / Burnout Mitigation">Occupational Health / Burnout Mitigation</option>
          <option value="Harassment and Whistleblowing safeguards">Harassment &amp; Regulatory Whistleblowing</option>
          <option value="Absenteeism Triage and Re-integration">Absenteeism Triage &amp; Re-integration</option>
        </select>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-semibold text-slate-705 mb-1" id="lbl-desc">
          Full Incident Logs (Sensitive Data allowed—will be auto-redacted)
        </label>
        <div className="relative">
          <textarea
            id="intake-desc-textarea"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Type incident report. Feel free to mention names or departments - our backend system automatically passes the report to Gemini to redact names, supervisor details, or corporate secrets into safe organizational labels before compiling..."
            className="w-full px-3 py-2 rounded-lg border border-slate-205 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none leading-relaxed transition-all text-slate-800 bg-white"
            disabled={isSubmitting}
          />
          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1 bg-slate-100/90 px-2 py-0.5 rounded text-[9px] font-bold text-slate-600 border border-slate-200/50 select-none">
            <UserMinus className="w-2.5 h-2.5 text-indigo-500" />
            AI Redactor Engaged
          </div>
        </div>
      </div>

      {/* Prior Interventions */}
      <div>
        <label className="block text-xs font-semibold text-slate-705 mb-1" id="lbl-interv">
          Prior Interventions Attempted
        </label>
        <input
          id="intake-interv-input"
          type="text"
          value={priorInterventions}
          onChange={(e) => setPriorInterventions(e.target.value)}
          placeholder="e.g. Employee requested generale benefit leaflets, supervisor requested feedback session"
          className="w-full px-3 py-2 rounded-lg border border-slate-205 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all text-slate-800 bg-white"
          disabled={isSubmitting}
        />
      </div>

      {/* Safety and Consent Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-55 p-3 rounded-lg border border-slate-200 bg-slate-50">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <ShieldAlert className="w-4 h-4 text-amber-650 shrink-0" />
            <span>Body/Life Safety Threat?</span>
          </div>
          <div className="flex gap-1.5 mt-1.5">
            {(['no', 'yes', 'unknown'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setImmediateSafetyConcern(v)}
                className={`flex-1 py-1 text-[10px] capitalize font-bold rounded-md border transition-all cursor-pointer ${
                  immediateSafetyConcern === v
                    ? "bg-slate-900 text-white border-transparent shadow-xs"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                }`}
                disabled={isSubmitting}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-705">
              <HeartHandshake className="w-4 h-4 text-emerald-650 shrink-0" />
              <span>Consent Logged?</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                id="intake-consent-checkbox"
                type="checkbox"
                checked={consentStatus}
                onChange={(e) => setConsentStatus(e.target.checked)}
                className="sr-only peer"
                disabled={isSubmitting}
              />
              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>
          <p className="text-[9px] text-slate-400 mt-1.5 leading-normal">
            Must be logged to share specific case data with EAP or counselor agencies
          </p>
        </div>
      </div>

      <button
        id="intake-submit-btn"
        type="submit"
        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-505 border border-transparent rounded-lg text-xs font-bold text-white shadow-xs hover:shadow-sm tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-indigo-605"
        disabled={isSubmitting}
      >
        <PlusCircle className="w-4 h-4" />
        {isSubmitting ? "Scrubbing &amp; Launching Room..." : "🛡️ Open Band Triage Room"}
      </button>
    </form>
  );
}
