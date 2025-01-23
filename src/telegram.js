import fetch from "node-fetch"; // Import fetch for Node.js environments

// Function to send a message on Telegram
export async function sendTelegramMessage(
  message,
  TELEGRAM_API_TOKEN,
  TELEGRAM_CHAT_ID
) {
  const url = `https://api.telegram.org/bot${TELEGRAM_API_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: "Markdown", // Enable Markdown formatting
    disable_web_page_preview: true, // Optional: Disable link previews
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error("Telegram API error:", data.description);
    } else {
      console.log("Message sent successfully:", data.result.message_id);
    }
  } catch (error) {
    console.error("Error sending Telegram message:", error.message);
  }
}
