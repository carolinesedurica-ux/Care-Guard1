import dotenv from "dotenv";
dotenv.config();

export interface BandAgentMe {
  id: string;
  name: string;
  handle: string;
  description: string;
  status: string;
}

export interface BandChat {
  id: string;
  title: string | null;
  task_id: string | null;
  inserted_at: string;
}

export class BandClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(customApiKey?: string) {
    this.apiKey = customApiKey || process.env.BAND_API_KEY || "";
    // Note: THENVOI_REST_URL in env represents key, fallback to app.band.ai
    this.baseUrl = (process.env.THENVOI_REST_URL || "https://app.band.ai/").trim();
    if (this.baseUrl.endsWith("/")) {
      this.baseUrl = this.baseUrl.slice(0, -1);
    }
  }

  public get isConfigured(): boolean {
    return !!this.apiKey;
  }

  private getHeaders() {
    return {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
    };
  }

  /**
   * Validates the connection on GET /api/v1/agent/me
   */
  public async testConnection(): Promise<{ success: boolean; agent?: BandAgentMe; error?: string }> {
    if (!this.apiKey) {
      return { success: false, error: "No BAND_API_KEY configured in environment variables." };
    }

    try {
      const url = `${this.baseUrl}/api/v1/agent/me`;
      console.log(`[BandClient] Testing connection: GET ${url}`);
      const res = await fetch(url, {
        method: "GET",
        headers: this.getHeaders()
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { success: false, error: `Band API returned ${res.status}: ${errorText}` };
      }

      const data = await res.json();
      // Band response usually is nested under key or direct
      const agent: BandAgentMe = data.agent || data;
      console.log(`[BandClient] Connected successfully as agent: ${agent.name} (${agent.handle})`);
      return { success: true, agent };
    } catch (err: any) {
      console.error(`[BandClient] Error checking agent profile:`, err);
      return { success: false, error: err.message || "Network request failed" };
    }
  }

  /**
   * Creates a Chat Room on POST /api/v1/agent/chats
   */
  public async createChatRoom(title: string): Promise<BandChat | null> {
    if (!this.apiKey) return null;

    try {
      const url = `${this.baseUrl}/api/v1/agent/chats`;
      console.log(`[BandClient] Creating chat room: POST ${url} -> ${title}`);
      
      const res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          chat: {
            title: title,
            task_id: null
          }
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[BandClient] Failed to create chat room: ${res.status} - ${errorText}`);
        return null;
      }

      const data = await res.json();
      return data.chat || data.data || data;
    } catch (err) {
      console.error("[BandClient] Error creating chat room:", err);
      return null;
    }
  }

  /**
   * Recruits / Adds a peer participant to the chat room: POST /api/v1/agent/chats/{chat_id}/participants
   * For internal agents, use their handle. For remote agents, use their UUID.
   */
  public async addParticipant(chatId: string, agentId: string, agentHandle?: string): Promise<any> {
    if (!this.apiKey) return null;

    try {
      const url = `${this.baseUrl}/api/v1/agent/chats/${chatId}/participants`;
      console.log(`[BandClient] Adding participant ${agentHandle || agentId} to chat ${chatId}: POST ${url}`);

      // Band API accepts handle for internal agents, id for remote agents
      const participantBody = agentHandle
        ? { participant: { handle: agentHandle } }
        : { participant: { id: agentId } };

      const res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(participantBody)
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[BandClient] Failed to add participant ${agentHandle || agentId}: ${res.status} - ${errorText}`);
        return null;
      }

      return await res.json();
    } catch (err) {
      console.error("[BandClient] Error adding participant:", err);
      return null;
    }
  }

  /**
   * Sends a text message as the agent on POST /api/v1/agent/chats/{chat_id}/messages
   */
  public async sendTextMessage(
    chatId: string,
    content: string,
    mentions: { id: string; handle?: string; name?: string }[] = []
  ): Promise<any> {
    if (!this.apiKey) return null;

    try {
      const url = `${this.baseUrl}/api/v1/agent/chats/${chatId}/messages`;
      console.log(`[BandClient] Sending message to ${chatId}: ${content.substring(0, 40)}... with ${mentions.length} mentions`);

      const res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          message: {
            content,
            mentions: mentions.map(m => ({
              id: m.id,
              handle: m.handle,
              name: m.name
            }))
          }
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[BandClient] Failed to send message: ${res.status} - ${errorText}`);
        return null;
      }

      return await res.json();
    } catch (err) {
      console.error("[BandClient] Error sending message:", err);
      return null;
    }
  }

  /**
   * Creates a chat event on POST /api/v1/agent/chats/{chat_id}/events
   */
  public async sendChatEvent(
    chatId: string,
    content: string,
    messageType: "thought" | "tool_call" | "tool_result" | "error" | "task",
    metadata?: any
  ): Promise<any> {
    if (!this.apiKey) return null;

    try {
      const url = `${this.baseUrl}/api/v1/agent/chats/${chatId}/events`;
      console.log(`[BandClient] Sending event [${messageType}] to ${chatId}`);

      const res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          event: {
            content,
            message_type: messageType,
            metadata: metadata || null
          }
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[BandClient] Failed to send event [${messageType}]: ${res.status} - ${errorText}`);
        return null;
      }

      return await res.json();
    } catch (err) {
      console.error("[BandClient] Error sending event:", err);
      return null;
    }
  }
}
