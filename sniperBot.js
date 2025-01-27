import WebSocket from "ws";
import { VersionedTransaction, Connection, Keypair } from '@solana/web3.js';
import fs from 'fs';
import fetch from "node-fetch";
import { sendTelegramMessage } from './src/telegram.js';
import { swap } from './src/performSwapV2.js'
import bs58 from "bs58";

let count = 0;
// Load private key from credentials file
let privateKey;
let privateKeyFake;
let TELEGRAM_API_TOKEN;
let TELEGRAM_CHAT_ID;
let heliusApiKey;
try {
    const credentials = JSON.parse(fs.readFileSync('./credentialsSniper.json', 'utf8'));
    privateKey = credentials.luki;
    TELEGRAM_API_TOKEN = credentials.telegramApiKey;
    TELEGRAM_CHAT_ID = credentials.telegramChatID;
    heliusApiKey = credentials.heliusApiKey;
} catch (error) {
    console.error("Failed to load private key:", error.message);
    process.exit(1);
}
const DG_Wallet = "G2WGvR38wZ3yZ7kvPS5KvYCrD5yWMbkgJXqzXMmGA1rD"
const SOL_ADDR = "So11111111111111111111111111111111111111112"
const SOL_BUY_AMOUNT = 0.1; // Amount of SOL to use for each purchase
const SOL_BUY_AMOUNT_FAKE = 1; // Amount of SOL to use for each purchase
const FEES = 0.003; // Transaction fees
const SLIPPAGE = 1000; // Slippage tolerance percentage

// Use a paid RPC endpoint here for best performance
const HeliusURL = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
const web3Connection = new Connection(HeliusURL);
// Counter and tracking for unique token buys
let buyAttemptsRemaining = 50; // Set the maximum number of unique tokens to buy
const boughtTokens = new Set(); // Set to track already bought tokens

async function fetchMetadata(uri) {
    try {
        const response = await fetch(uri);
        if (!response.ok) {
            console.error(`Failed to fetch metadata from URI: ${uri}`);
            return null;
        }
        const metadata = await response.json();
        return metadata;
    } catch (error) {
        console.error(`Error fetching metadata from URI: ${uri}`, error);
        return null;
    }
}

async function checkWebsiteExists(url) {
    try {
        const absoluteUrl = url.startsWith('http') ? url : `https://${url}`;
        const response = await fetch(absoluteUrl);
        if (response.ok) {
            console.log(`Website exists: ${absoluteUrl}`);
            return true;
        } else {
            console.warn(`Website returned status ${response.status}: ${absoluteUrl}`);
            return false;
        }
    } catch (error) {
        if (error.code === 'ENOTFOUND') {
            console.error(`Website not found: ${url}. This might indicate a scammy or invalid domain.`);
        } else {
            console.error(`Error checking website: ${url}`, error);
        }
        return false;
    }
}

/**
 * Fetch creator key and name from the Pump API response.
 * @param {string} tokenId - The token ID to fetch data for.
 * @returns {Promise<{ creator: string | null, name: string | null }>} - An object containing the creator key and name, or null if not found.
 */
async function fetchCreatorKeyAndName(tokenId) {
    const apiUrl = `https://frontend-api.pump.fun/coins/${tokenId}`;
    
    try {
        const response = await fetch(apiUrl, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            console.error(`Failed to fetch data: ${response.status} ${response.statusText}`);
            return { creator: null, name: null };
        }

        const data = await response.json();

        // Extract and return the creator key and name
        const creator = data?.creator || null;
        const name = data?.name || null;

        if (creator) {
            console.log(`Creator Key: ${creator}`);
        } else {
            console.warn("Creator key not found in the response.");
        }

        if (name) {
            console.log(`Name: ${name}`);
        } else {
            console.warn("Name not found in the response.");
        }

        return { creator, name };
    } catch (error) {
        console.error(`Error fetching data from Pump API: ${error.message}`);
        return { creator: null, name: null };
    }
}


async function checkTwitterAccountExists(twitterHandle) {
    try {
        const response = await fetch(twitterHandle.startsWith('https') ? twitterHandle : `https://twitter.com/${twitterHandle}`);
        if (response.ok) {
            console.log(`Twitter account exists: ${twitterHandle}`);
            return true;
        } else {
            console.warn(`Twitter returned status ${response.status}: ${twitterHandle}`);
            return false;
        }
    } catch (error) {
        console.error(`Error checking Twitter account: ${twitterHandle}`, error);
        return false;
    }
}

async function checkTelegramGroupExists(telegramLink) {
    try {
        const response = await fetch(telegramLink.startsWith('https') ? telegramLink : `https://${telegramLink}`);
        if (response.ok) {
            console.log(`Telegram group exists: ${telegramLink}`);
            return true;
        } else {
            console.warn(`Telegram link returned status ${response.status}: ${telegramLink}`);
            return false;
        }
    } catch (error) {
        console.error(`Error checking Telegram link: ${telegramLink}`, error);
        return false;
    }
}

let heartbeatTimeout;

function connectWebSocket() {
    const ws = new WebSocket("wss://pumpportal.fun/api/data");

    let heartbeatInterval;
    let lastHeartbeatTime = Date.now();

    function startHeartbeat(ws) {
        // Clear any existing intervals
        if (heartbeatInterval) clearInterval(heartbeatInterval);

        // Send periodic pings every 10 minutes
        heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.ping();
                console.log("Sent heartbeat ping.");
            } else {
                console.warn("WebSocket is not open. Stopping heartbeat.");
                clearInterval(heartbeatInterval);
            }
        }, 10 * 60 * 1000); // 10 minutes

        // Monitor the last heartbeat response
        setInterval(() => {
            if (Date.now() - lastHeartbeatTime > 30 * 60 * 1000) { // 30 minutes
                console.error("No heartbeat received in the last 30 minutes. Reconnecting...");
                ws.close(); // Force reconnection
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
    }

    ws.on("pong", function pong() {
        lastHeartbeatTime = Date.now();
        console.log("Received heartbeat pong from server.");
    });

    ws.on("close", function close() {
        console.warn("WebSocket connection closed. Stopping heartbeat.");
        clearInterval(heartbeatInterval); // Clear heartbeat on closure
        setTimeout(() => {
            connectWebSocket(); // Reconnect after 5 seconds
        }, 5000);
    });


    ws.on("open", function open() {
        // Subscribing to token creation events
        let payload = {
            method: "subscribeNewToken",
        };
        startHeartbeat();
        ws.send(JSON.stringify(payload));
    });
    ws.on("message", async function message(data) {
        const tokenCreationData = JSON.parse(data);
        startHeartbeat();
        console.log("Token data received:", tokenCreationData);
    
        // Check if the message is the specific subscription confirmation
        if (tokenCreationData.message === "Successfully subscribed to token creation events.") {
            console.log("Received subscription confirmation. Skipping processing.");
            return;
        }
        // let creatorKey = await fetchCreatorKeyAndName(tokenCreationData.mint)
        // console.log("Key" + creatorKey.creator);
        // console.log("Name" + creatorKey.name);

        let symbolTmp = tokenCreationData.symbol.toUpperCase();
        let symbolFilter;
        if(symbolTmp === "COOKIE"){
            symbolFilter = true;
        }else{
            symbolFilter = false;
        }
        //\`${signerPublicKey}\`
        //const symbolFilter = tokenCreationData.symbol.includes("Your Symbol");
        if (symbolFilter) {
            const message = `🚨 *New Token Detected on Pumpfun* 🚨\n\n` +
                            `🔹 *Mint:* \`${tokenCreationData.mint}\`\n` +
                            `🔹 *Name:* ${tokenCreationData.name}\n` +
                            `🔹 *Ticker:* ${tokenCreationData.symbol}\n` +
                            `🔹 *Creator:* (_\`${tokenCreationData.traderPublicKey}\`_)\n` +
                            `🔹 *Developer Initial Buy:* ${tokenCreationData.solAmount} SOL`;
            await sendTelegramMessage(message, TELEGRAM_API_TOKEN, TELEGRAM_CHAT_ID);
        } else if (false) {
            const message = `🚨 *Add Liquidity Detected on Raydium* 🚨\n\n` +
                            `🔹 *Mint:* ${tokenCreationData.mint}\n` +
                            `🔹 *Ticker:* ${tokenCreationData.symbol}\n` +
                            `🔹 *Creator:* IS DG's Wallet (_${tokenCreationData.traderPublicKey}_)\n` +
                            `🔹 *Developer Initial Buy:* ${tokenCreationData.solAmount} SOL`;
            await sendTelegramMessage(message, TELEGRAM_API_TOKEN, TELEGRAM_CHAT_ID);
        }
        
        if (symbolFilter && false) {
            count = count + 1;
            const tokenMint = tokenCreationData.mint;
            console.log("Buying: " + tokenMint);
    
            // Add the token to the set of bought tokens
            boughtTokens.add(tokenMint);
            buyAttemptsRemaining--; // Decrement the counter
    
            const signerKeyPair = Keypair.fromSecretKey(bs58.decode(privateKey));
            const signerPublicKey = signerKeyPair.publicKey.toBase58();

            // Perform the buy transaction
            let maxRetries = 1;
            let txid;
            try {
              txid = await swap(
                SOL_ADDR, 
                tokenMint, 
                SOL_BUY_AMOUNT, 
                SLIPPAGE, 
                maxRetries, 
                privateKey, 
                web3Connection);
            } catch (error) {
                console.error("Error performing swap:", error.message);
            }
            const message = `🤖 *Coin Purchase Notification*\n\n📈 *Coin:* ${tokenMint}\n💰 *Amount:* ${SOL_BUY_AMOUNT}\n💵 *TXID:* [View Transaction](https://solscan.io/tx/${txid}) \n\n✅ Purchase successful! Wallet: \`${signerPublicKey}\``;
            await sendTelegramMessage(message, TELEGRAM_API_TOKEN, TELEGRAM_CHAT_ID);
        } else if (symbolFilter && false) {
            count = count + 1;
            const tokenMint = tokenCreationData.mint;
            console.log("Buying: " + tokenMint);
    
            // Add the token to the set of bought tokens
            boughtTokens.add(tokenMint);
            buyAttemptsRemaining--; // Decrement the counter
    
            const signerKeyPair = Keypair.fromSecretKey(bs58.decode(privateKey));
            const signerPublicKey = signerKeyPair.publicKey.toBase58();

            // Perform the buy transaction
            let maxRetries = 1;
            let txid;
            try {
              txid = await swap(
                SOL_ADDR, 
                tokenMint, 
                SOL_BUY_AMOUNT_FAKE, 
                SLIPPAGE, 
                maxRetries, 
                privateKey, 
                web3Connection);
            } catch (error) {
                console.error("Error performing swap:", error.message);
            }
            const message = `🤖 *Coin Purchase Notification*\n\n📈 *Coin:* ${tokenMint}\n💰 *Amount:* ${SOL_BUY_AMOUNT}\n💵 *TXID:* [View Transaction](https://solscan.io/tx/${txid}) \n\n✅ Purchase successful! Wallet: \`${signerPublicKey}\``;
            await sendTelegramMessage(message, TELEGRAM_API_TOKEN, TELEGRAM_CHAT_ID);
        } else {
            console.log("Token does not meet all requirements (hasAI, ends with pump, solAmount). Skipping.")
        }
    });

    ws.on("close", function close() {
        console.warn("WebSocket connection closed. Reconnecting...");
        clearTimeout(heartbeatTimeout);
        setTimeout(() => {
            connectWebSocket();
        }, 5000);
    });

    ws.on("error", function error(err) {
        console.error("WebSocket error:", err.message);
        console.warn("Attempting to reconnect...");
        ws.close(); // Ensure the 'close' event triggers reconnection
    });
}



async function sendPumpTransaction(action, mint, amount) {
    const signerKeyPair = Keypair.fromSecretKey(bs58.default.decode(privateKey));
    const signerPublicKey = signerKeyPair.publicKey.toBase58();
    const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            publicKey: signerPublicKey,
            "action": action, // "buy" or "sell"
            "mint": mint, // contract address of the token you want to trade
            "denominatedInSol": "true",  // "true" if amount is amount of SOL, "false" if amount is number of tokens
            "amount": amount, // amount of SOL or tokens
            "slippage": 20, // percent slippage allowed
            "priorityFee": 0.01, // priority fee
            "pool": "pump"
        })
    });
    if (response.status === 200) { // successfully generated transaction
        const data = await response.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(data));
        tx.sign([signerKeyPair]);
        let signature;
        try {
            signature = await web3Connection.sendTransaction(tx, { preflightCommitment: "processed" });
        } catch (e) {
            console.error(e.message);
        }
        console.log("Transaction: https://solscan.io/tx/" + signature);
        const message = `🤖 *Coin Purchase Notification*\n\n📈 *Coin:* ${mint}\n💰 *Amount:* ${amount}\n💵 *TXID:* [View Transaction](https://solscan.io/tx/${signature}) \n\n✅ Purchase successful! Wallet: \`${signerPublicKey}\``;
        await sendTelegramMessage(message, TELEGRAM_API_TOKEN, TELEGRAM_CHAT_ID);
    } else {
        console.log("Transaction failed:", response.statusText);
    }
}

// Start the WebSocket connection
connectWebSocket();