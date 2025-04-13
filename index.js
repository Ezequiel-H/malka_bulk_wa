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

let whatsappSocket = null;
const YOUR_NUMBER = "5491121707442@s.whatsapp.net";

const app = express();
const PORT = process.env.PORT || 2000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

            whatsappSocket.ev.on("messages.upsert", async (m) => {
                if (m.type === "notify") {
                    for (const msg of m.messages) {
                        if (msg.key.remoteJid === YOUR_NUMBER) {
                            try {
                                // Check if it's a document message (CSV file)
                                if (msg.message.documentMessage) {
                                    const buffer = await downloadMediaMessage(msg, "buffer", {
                                        logger: pino({ level: "silent" }),
                                    });

                                    // Convert buffer to string and parse CSV
                                    const csvContent = buffer.toString('utf-8');
                                    
                                    // Parse CSV
                                    const lines = csvContent.split('\n');
                                    console.log(`Received CSV with ${lines.length} lines (including header)`);
                                    
                                    // Get the message template from the first line
                                    const messageTemplate = lines[0];
                                    if (!messageTemplate) {
                                        await whatsappSocket.sendMessage(YOUR_NUMBER, { 
                                            text: "Error: Message template not found in CSV" 
                                        });
                                        continue;
                                    }

                                    // Get headers from the second line
                                    const headers = lines[1].split(',').map(h => h.trim());
                                    if (!headers.length) {
                                        await whatsappSocket.sendMessage(YOUR_NUMBER, { 
                                            text: "Error: Headers not found in CSV" 
                                        });
                                        continue;
                                    }

                                    // Process each row starting from the third line (after message template and headers)
                                    const results = [];
                                    for (let i = 2; i < lines.length; i++) {
                                        if (!lines[i].trim()) continue;
                                        
                                        const values = lines[i].split(',').map(v => v.trim());
                                        const phone = values[0]; // First column is always phone number

                                        if (!phone) {
                                            results.push({ phone, status: 'error', error: 'Missing phone number' });
                                            continue;
                                        }

                                        try {
                                            // Replace variables in the message
                                            let message = messageTemplate;
                                            for (let j = 1; j < headers.length; j++) {
                                                const columnName = headers[j];
                                                const value = values[j] || '';
                                                message = message.replace(new RegExp(`{{${columnName}}}`, 'g'), value);
                                            }

                                            await whatsappSocket.sendMessage(phone + "@s.whatsapp.net", { text: message });
                                            results.push({ phone, status: 'success' });
                                        } catch (error) {
                                            results.push({ phone, status: 'error', error: error.message });
                                        }
                                    }

                                    // Send summary back to you
                                    const successCount = results.filter(r => r.status === 'success').length;
                                    const errorCount = results.filter(r => r.status === 'error').length;
                                    await whatsappSocket.sendMessage(YOUR_NUMBER, { 
                                        text: `CSV processing completed!\nSuccess: ${successCount}\nFailed: ${errorCount}` 
                                    });
                                    continue;
                                }

                                const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;
                                if (!messageText) continue;

                                // Split message into lines and validate structure
                                const lines = messageText.split('\n').map(line => line.trim());
                                
                                // Check if message starts with AAA-AAA and has at least 3 lines (prefix, message, and at least one number)
                                if (lines[0] !== "AAA-AAA" || lines.length < 3) {
                                    continue;
                                }

                                // Parse the message
                                const message = lines[1]; // Second line is the message
                                const phoneNumbers = lines.slice(2).filter(line => line.trim()); // Rest are phone numbers

                                if (phoneNumbers.length === 0) {
                                    await whatsappSocket.sendMessage(YOUR_NUMBER, { text: "Error: No phone numbers provided" });
                                    continue;
                                }

                                // Send messages to all numbers
                                const results = [];
                                for (const phone of phoneNumbers) {
                                    try {
                                        await whatsappSocket.sendMessage(phone + "@s.whatsapp.net", { text: message });
                                        results.push({ phone, status: 'success' });
                                    } catch (error) {
                                        results.push({ phone, status: 'error', error: error.message });
                                    }
                                }

                                // Send summary back to you
                                const successCount = results.filter(r => r.status === 'success').length;
                                const errorCount = results.filter(r => r.status === 'error').length;
                                await whatsappSocket.sendMessage(YOUR_NUMBER, { 
                                    text: `Message sending completed!\nSuccess: ${successCount}\nFailed: ${errorCount}` 
                                });

                            } catch (error) {
                                await whatsappSocket.sendMessage(YOUR_NUMBER, { 
                                    text: `Error processing your message: ${error.message}` 
                                });
                            }
                        }
                    }
                }
            });

        } catch (error) {
            await fs.emptyDir(__dirname + "/auth_info_baileys");
        }
    }

    SUHAIL().catch(async (error) => {
        await fs.emptyDir(__dirname + "/auth_info_baileys");
    });
});

app.listen(PORT, () => console.log(`App running at http://localhost:${PORT}`));
