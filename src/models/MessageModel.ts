import mongoose, { Schema, Document } from "mongoose";
import type { BandMessage } from "../types";

const MessageSchema = new Schema<BandMessage & Document>({
  id: { type: String, required: true, unique: true, index: true },
  caseId: { type: String, required: true, index: true },
  agent: String,
  agentName: String,
  agentAvatar: String,
  content: String,
  structuredData: Schema.Types.Mixed,
  mentions: [String],
  timestamp: String,
  type: String,
}, { timestamps: false });

export const MessageModel = (mongoose.models.Message || mongoose.model<BandMessage & Document>("Message", MessageSchema)) as mongoose.Model<any>;
