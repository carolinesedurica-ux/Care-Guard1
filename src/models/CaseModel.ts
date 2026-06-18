import mongoose, { Schema, Document } from "mongoose";
import type { WorkplaceCase, FinalMemo } from "../types";

const FinalMemoSchema = new Schema<FinalMemo>({
  finalRiskLevel: String,
  requiresHumanReview: Boolean,
  recommendedNextStep: String,
  rationale: [String],
  humanReviewerChecklist: [String],
}, { _id: false });

const CaseSchema = new Schema<WorkplaceCase & Document>({
  id: { type: String, required: true, unique: true, index: true },
  title: String,
  description: String,
  redactedDescription: String,
  department: String,
  dateOfIncident: String,
  immediateSafetyConcern: String,
  consentStatus: Boolean,
  priorInterventions: String,
  policyCategory: String,
  status: String,
  riskLevel: String,
  bandRoomId: String,
  createdAt: String,
  updatedAt: String,
  urgentFlags: [String],
  missingInformation: [String],
  requiresHumanReview: Boolean,
  finalRecommendation: String,
  humanReviewerChecklist: [String],
  finalMemoCompiled: FinalMemoSchema,
}, { timestamps: false });

export const CaseModel = (mongoose.models.Case || mongoose.model<WorkplaceCase & Document>("Case", CaseSchema)) as mongoose.Model<any>;
