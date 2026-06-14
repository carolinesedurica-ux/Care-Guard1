import { motion } from "motion/react";

interface RiskGaugeProps {
  riskLevel: 'low' | 'moderate' | 'high' | 'critical' | null;
}

export default function RiskGauge({ riskLevel }: RiskGaugeProps) {
  const levels = {
    low: { color: "#10B981", bg: "bg-emerald-500/10", label: "Low", angle: -45, text: "text-emerald-500" },
    moderate: { color: "#F59E0B", bg: "bg-amber-500/10", label: "Moderate", angle: 0, text: "text-amber-500" },
    high: { color: "#EF4444", bg: "bg-red-500/10", label: "High", angle: 45, text: "text-red-500" },
    critical: { color: "#7C3AED", bg: "bg-purple-500/10", label: "Critical", angle: 90, text: "text-purple-500" },
  };

  const current = riskLevel ? levels[riskLevel] : { color: "#9CA3AF", bg: "bg-gray-500/10", label: "Unassessed", angle: -90, text: "text-gray-400" };

  return (
    <div className={`p-4 rounded-xl border border-slate-200 flex flex-col items-center justify-center ${current.bg} transition-colors duration-500 shadow-3xs`}>
      <span className="text-[10px] uppercase tracking-widest font-mono text-slate-500 font-bold mb-2">Psychosocial Risk Dial</span>
      
      <div className="relative w-32 h-20 overflow-hidden flex items-end justify-center">
        {/* Arc Background */}
        <svg className="absolute w-32 h-16 bottom-0" viewBox="0 0 100 50">
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="#E5E7EB"
            strokeWidth="8"
            strokeLinecap="round"
          />
          {/* Active Arc Highlight */}
          {riskLevel && (
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke={current.color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="125"
              strokeDashoffset={
                riskLevel === "low" ? 90 :
                riskLevel === "moderate" ? 62 :
                riskLevel === "high" ? 31 : 0
              }
              className="transition-all duration-1000 ease-out"
            />
          )}
        </svg>

        {/* Needle */}
        <motion.div
          animate={{ rotate: current.angle }}
          transition={{ type: "spring", stiffness: 60, damping: 15 }}
          style={{ originX: "50%", originY: "100%" }}
          className="absolute bottom-0 w-1.5 h-12 bg-gray-800 rounded-t-full"
        >
          <div className="w-3 h-3 -ml-[3px] bg-gray-900 rounded-full absolute bottom-0" />
        </motion.div>
      </div>

      <div className="mt-2 text-center">
        <span className={`text-lg font-bold tracking-tight ${current.text}`}>
          {current.label}
        </span>
      </div>
    </div>
  );
}
