import { fileURLToPath } from 'url';
import express from "express";
import pino from "pino";
import { toBuffer } from "qrcode";
import path from 'path';
import fs from "fs-extra";
import { Boom } from "@hapi/boom";
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const baileys = await import('@whiskeysockets/baileys');
const {
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    delay,
    DisconnectReason,
    makeInMemoryStore,
} = baileys;

const app = express();
const PORT = process.env.PORT || 3000;
const MESSAGE = process.env.MESSAGE || `Hello`;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

async function processPDFMessage(message) {
    const msgType = Object.keys(message.message)[0];
    console.log("Message Type:", msgType);

    if (msgType === "documentMessage") {
        console.log("PDF file received!");

        try {
            const buffer = await downloadMediaMessage(message, "buffer", {
                logger: pino({ level: "silent" }),
            });

            const originalFileName = message.message.documentMessage.fileName || `${Date.now()}.pdf`;
            const downloadsDir = path.join(__dirname, "downloads");

            if (!fs.existsSync(downloadsDir)) {
                fs.mkdirSync(downloadsDir, { recursive: true });
            }

            const filePath = path.join(downloadsDir, originalFileName);
            fs.writeFileSync(filePath, buffer);
            console.log(`PDF file saved: ${filePath}`);
        } catch (error) {
            console.error("Failed to download PDF:", error);
        }
    }
}

app.use("/", async (req, res) => {
    async function SUHAIL() {
        const { state, saveCreds } = await useMultiFileAuthState(__dirname + "/auth_info_baileys");

        try {
            const Smd = makeWASocket({
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.baileys("Desktop"),
                auth: state,
            });

            Smd.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log("QR Code available. Scan it to authenticate.");
                    res.end(await toBuffer(qr));
                }

                if (connection === "open") {
                    console.log("Connection opened, user authenticated!");
                    const user = Smd.user.id;

                    try {
                        const phones = ["54911217074"];
                        await Promise.all(
                            phones.map(async (phone) => {
                                await Smd.sendMessage(phone + "@s.whatsapp.net", { text: MESSAGE });
                            })
                        );

                        await delay(1000);
                    } catch (error) {
                        console.error("Error sending message:", error);
                    }
                }

                if (connection === "close") {
                    const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                    console.error("Connection closed. Reason:", reason);

                    if (reason === DisconnectReason.restartRequired || reason === DisconnectReason.timedOut) {
                        console.log("Attempting to reconnect...");
                        SUHAIL();
                    } else {
                        console.log("Unexpected disconnection. Manual intervention required.");
                    }
                }
            });

            Smd.ev.on("creds.update", saveCreds);

            Smd.ev.on("messages.upsert", async (msg) => {
              if (msg.type === "notify") {
                  const messages = msg.messages;
                  for (let message of messages) {
                      if (!message.message || message.key.fromMe) continue;
                      await processPDFMessage(message);
                  }
              }
          });
          
        } catch (error) {
            console.error("Error in SUHAIL function:", error);
            await fs.emptyDir(__dirname + "/auth_info_baileys");
        }
    }

    SUHAIL().catch(async (error) => {
        console.error("Error initializing SUHAIL:", error);
        await fs.emptyDir(__dirname + "/auth_info_baileys");
    });
});

app.listen(PORT, () => console.log(`App running at http://localhost:${PORT}`));
