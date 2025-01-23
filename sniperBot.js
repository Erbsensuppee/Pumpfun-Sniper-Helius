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
let TELEGRAM_API_TOKEN;
let TELEGRAM_CHAT_ID;
let heliusApiKey;
try {
    const credentials = JSON.parse(fs.readFileSync('./credentialsSniper.json', 'utf8'));
    privateKey = credentials.privateKey;
    TELEGRAM_API_TOKEN = credentials.telegramApiKey;
    TELEGRAM_CHAT_ID = credentials.telegramChatID;
    heliusApiKey = credentials.heliusApiKey;
} catch (error) {
    console.error("Failed to load private key:", error.message);
    process.exit(1);
}

const SOL_ADDR = "So11111111111111111111111111111111111111112"
const SOL_BUY_AMOUNT = 0.001; // Amount of SOL to use for each purchase
const FEES = 0.003; // Transaction fees
const SLIPPAGE = 15; // Slippage tolerance percentage

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

    function startHeartbeat() {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => {
            console.error("Connection lost due to heartbeat timeout.");
            ws.close(); // Force close to trigger reconnection
        }, 10000); // 10 seconds timeout for pong
    }

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
    
        // Fetch metadata from the URI if available
        if (!tokenCreationData.uri) {
            console.log("No metadata URI available for token:", tokenCreationData.mint);
            return;
        }
    
        // DG FILTER
        let symbolTmp = tokenCreationData.symbol.toUpperCase();
        let nameTmp = tokenCreationData.name.toUpperCase();
        const nameFilter = tokenCreationData.name.includes("Ew2mQaojHQXQ");
        const symbolFilter = tokenCreationData.symbol.includes("DKT");
        //const symbolFilter = tokenCreationData.symbol.includes("Your Symbol");
        
        if (nameFilter) {
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
                "FsaEyWwhdvAG1qdwNB9tSAMm62UGkigcbRVJE3Zzpump", 
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
        } else if (buyAttemptsRemaining <= 0) {
            console.log("Maximum unique tokens bought. No further transactions will be made.");
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