import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

function cleanHtml(html: string): string {
  // Strip head, script, style, svg, header, footer, etc.
  let cleaned = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Replace tags with spaces or newlines
  cleaned = cleaned
    .replace(/<\/p>|<\/div>|<\/h1>|<\/h2>|<\/h3>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  // Clean trailing spaces and excessive empty lines
  cleaned = cleaned
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n");

  return cleaned;
}

async function run() {
  const urls = [
    "https://docs.band.ai/api/introduction",
    "https://docs.band.ai/integrations/sdks/tutorials/setup",
    "https://docs.band.ai/getting-started/connect-remote-agent"
  ];

  for (const url of urls) {
    console.log(`\n==============================================`);
    console.log(`=== EXTRACTED TEXT FOR: ${url} ===`);
    console.log(`==============================================`);
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
      });
      const html = await response.text();
      const text = cleanHtml(html);
      
      // Save full clean text to a file
      const baseName = url.split("/").pop();
      fs.writeFileSync(`clean_${baseName}.txt`, text);
      console.log(`Saved clean text to clean_${baseName}.txt`);
      
      // Print first 100 lines
      const lin = text.split("\n");
      console.log(lin.slice(0, 150).join("\n"));
    } catch (err: any) {
      console.error(err);
    }
  }
}

run();
