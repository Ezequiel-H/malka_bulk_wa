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

// Add module-level variable for WhatsApp socket
let whatsappSocket = null;

const app = express();
const PORT = process.env.PORT || 2000;
const MESSAGE = process.env.MESSAGE || `Hello`;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add middleware to parse JSON bodies
app.use(express.json());

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

app.use("/", async (req, res) => {
    async function SUHAIL() {
        const { state, saveCreds } = await useMultiFileAuthState(__dirname + "/auth_info_baileys");

        try {
            whatsappSocket = makeWASocket({
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.baileys("Desktop"),
                auth: state,
            });

            whatsappSocket.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log("QR Code available. Scan it to authenticate.");
                    res.end(await toBuffer(qr));
                }

                if (connection === "open") {
                    console.log("Connection opened, user authenticated!");
                    const user = whatsappSocket.user.id;

                    try {
                        const phones = ["54911217074"];
                        await Promise.all(
                            phones.map(async (phone) => {
                                await whatsappSocket.sendMessage(phone + "@s.whatsapp.net", { text: MESSAGE });
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

            whatsappSocket.ev.on("creds.update", saveCreds);
          
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

// Add new endpoint for sending messages to multiple numbers
app.post('/send-messages', async (req, res) => {
    try {
        const { phoneNumbers, message } = req.body;
        console.log(phoneNumbers, message);
        
        if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of phone numbers' });
        }

        if (!message) {
            return res.status(400).json({ error: 'Please provide a message to send' });
        }

        if (!whatsappSocket) {
            return res.status(503).json({ error: 'WhatsApp connection not established yet' });
        }

        const results = await Promise.all(
            phoneNumbers.map(async (phone) => {
                try {
                    await whatsappSocket.sendMessage(phone + "@s.whatsapp.net", { text: message });
                    return { phone, status: 'success' };
                } catch (error) {
                    return { phone, status: 'error', error: error.message };
                }
            })
        );

        res.json({ results });
    } catch (error) {
        console.error('Error sending messages:', error);
        res.status(500).json({ error: 'Failed to send messages' });
    }
});

app.listen(PORT, () => console.log(`App running at http://localhost:${PORT}`));
