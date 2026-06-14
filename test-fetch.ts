import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

async function fetchMd(url: string, filename: string) {
  console.log(`\n=== FETCHING MD: ${url} ===`);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      }
    });
    const text = await response.text();
    fs.writeFileSync(filename, text);
    console.log(`Saved ${filename} (${text.length} bytes)`);
    // Print first 40 lines
    console.log(text.split("\n").slice(0, 40).join("\n"));
  } catch (err: any) {
    console.error(`Error fetching ${url}:`, err.message || err);
  }
}

async function run() {
  const filesToFetch = [
    {
      url: "https://docs.band.ai/api/agent-api/agent-api-messages/create-agent-chat-message.md",
      name: "api_create_message.md"
    },
    {
      url: "https://docs.band.ai/api/agent-api/agent-api-events/create-agent-chat-event.md",
      name: "api_create_event.md"
    },
    {
      url: "https://docs.band.ai/api/agent-api/agent-api-chats/create-agent-chat.md",
      name: "api_create_chat.md"
    },
    {
      url: "https://docs.band.ai/api/agent-api/agent-api-chats/list-agent-chats.md",
      name: "api_list_chats.md"
    }
  ];

  for (const item of filesToFetch) {
    await fetchMd(item.url, item.name);
  }
}

run();
