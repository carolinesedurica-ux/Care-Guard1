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
    // BAND_REST_URL is the official env var per docs.band.ai; THENVOI_REST_URL kept for backwards compat
    this.baseUrl = (process.env.BAND_REST_URL || process.env.THENVOI_REST_URL || "https://app.band.ai/").trim();
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
      // Band response is nested under "data" (e.g. { data: { id, name, handle, ... } })
      const agent: BandAgentMe = data.data || data.agent || data;
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
   * For internal agents (same workspace), Band API requires the handle field.
   * For external agents, participant_id (UUID) is used.
   */
  public async addParticipant(chatId: string, agentId: string, agentHandle?: string): Promise<any> {
    if (!this.apiKey) return null;

    try {
      const url = `${this.baseUrl}/api/v1/agent/chats/${chatId}/participants`;
      console.log(`[BandClient] Adding participant ${agentHandle || agentId} to chat ${chatId}: POST ${url}`);

      // Internal agents must be added by handle; external agents by participant_id
      const participantBody = agentHandle
        ? { handle: agentHandle }
        : { participant_id: agentId };

      const res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ participant: participantBody })
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
   * Creates a new agent on Band.ai using the account-level personal API key.
   * The personal key (band_u_...) has workspace-admin scope and can create agents.
   * Returns the new agent's id, handle, and its own api_key, or null on failure.
   */
  public async createAgent(
    params: { name: string; handle: string; description: string; webhookUrl?: string },
    personalApiKey: string
  ): Promise<{ id: string; handle: string; apiKey: string; name: string } | null> {
    if (!personalApiKey) return null;

    try {
      const url = `${this.baseUrl}/api/v1/agents`;
      console.log(`[BandClient] Creating agent "${params.name}": POST ${url}`);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${personalApiKey}`,
          "X-API-Key": personalApiKey,
        },
        body: JSON.stringify({
          agent: {
            name: params.name,
            handle: params.handle,
            description: params.description,
            webhook_url: params.webhookUrl || null,
          },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[BandClient] Failed to create agent "${params.name}": ${res.status} - ${errorText}`);
        return null;
      }

      const data = await res.json();
      const agent = data.agent || data.data || data;
      const apiKey = agent.api_key || agent.apiKey || agent.token || "";
      console.log(`[BandClient] Agent created: ${agent.name} (${agent.handle})`);
      return { id: agent.id, handle: agent.handle, apiKey, name: agent.name };
    } catch (err: any) {
      console.error(`[BandClient] Error creating agent "${params.name}":`, err);
      return null;
    }
  }

  /**
   * Updates the webhook URL for an existing agent via PATCH /api/v1/agents/{handle}
   */
  /**
   * Tries to fetch an agent's API key via GET /api/v1/agents/{handle}.
   * The personal key (band_u_...) has workspace-admin scope and may return the agent key.
   * Returns null if the endpoint doesn't expose it.
   */
  public async fetchAgentApiKey(handle: string, personalApiKey: string): Promise<string | null> {
    if (!personalApiKey) return null;
    try {
      const cleanHandle = handle.replace(/^@/, "");
      const url = `${this.baseUrl}/api/v1/agents/${cleanHandle}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${personalApiKey}`,
          "X-API-Key": personalApiKey,
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const agent = data.agent || data.data || data;
      const key = agent.api_key || agent.apiKey || agent.token || null;
      if (key) console.log(`[BandClient] Retrieved API key for ${handle}`);
      return key;
    } catch {
      return null;
    }
  }

  public async updateWebhook(
    agentHandle: string,
    webhookUrl: string,
    personalApiKey: string
  ): Promise<boolean> {
    if (!personalApiKey) return false;
    try {
      const cleanHandle = agentHandle.replace(/^@/, "");
      const url = `${this.baseUrl}/api/v1/agents/${cleanHandle}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${personalApiKey}`,
          "X-API-Key": personalApiKey,
        },
        body: JSON.stringify({ agent: { webhook_url: webhookUrl } }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[BandClient] Failed to update webhook for ${agentHandle}: ${res.status} - ${errorText}`);
      }
      return res.ok;
    } catch (err: any) {
      console.error(`[BandClient] Error updating webhook for ${agentHandle}:`, err);
      return false;
    }
  }

  /**
   * Fetches recent messages from a chat room: GET /api/v1/agent/chats/{chat_id}/messages
   * Used by webhook handlers to build conversation context before generating a reply.
   */
  public async getMessages(chatId: string, limit: number = 20): Promise<any[]> {
    if (!this.apiKey) return [];
    try {
      const url = `${this.baseUrl}/api/v1/agent/chats/${chatId}/messages?limit=${limit}`;
      const res = await fetch(url, { method: "GET", headers: this.getHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      return data.messages || data.data || [];
    } catch (err) {
      console.error("[BandClient] Error fetching messages:", err);
      return [];
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
