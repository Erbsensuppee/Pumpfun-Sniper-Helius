import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { SolanaTracker } from "solana-swap";
import { performSwap, SOL_ADDR } from "./lib.js";
import bs58 from "bs58";
import fs from "fs";

// Load private key from credentials file
let privateKey;
let heliusApiKey;
let solanaTrackerApiKey;
try {
    const credentials = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'));
    privateKey = credentials.key1;
    heliusApiKey = credentials.heliusApiKey;
    solanaTrackerApiKey = credentials.solanaTrackerApiKey;
} catch (error) {
    console.error("Failed to load private key:", error.message);
    process.exit(1);
}

// RPC URLs
const RPC_URLS = [
  `https://rpc-mainnet.solanatracker.io/?api_key=${solanaTrackerApiKey}`,
  `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
];

// Configuration Variables
const RPC_URL = "https://api.mainnet-beta.solana.com"; // Replace with your preferred RPC endpoint
const PRIVKEY = privateKey; // Replace with your actual private key
let TOKEN_ADDR = null; // Replace with your target token address
const SOL_BUY_AMOUNT = 0.001; // Amount of SOL to use for each purchase
const FEES = 0.0003; // Transaction fees
const SLIPPAGE = 10; // Slippage tolerance percentage
const RETRY_DELAY = 500; // Delay between retries in milliseconds
const MAX_RETRIES = 3; // Maximum number of retry attempts

const url = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;

let assetDatabase = null;
let pageCounter = 1;
let pageLimit = 1000;
let assetLastCheckedIndex = 0;

// Switch between 'hour' and 'minute'
let mode = 'minute'; // Change to 'hour' for hourly buys

// Utility function to pause execution for the specified duration
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function getAssetsByAuthority() {
  console.log(`Fetching assets for page ${pageCounter}...`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getAssetsByAuthority',
      params: {
        authorityAddress: 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM',
        page: pageCounter, // Starts at 1
        limit: pageLimit,
      },
    }),
  });

  if (!response.ok) {
    console.error(`Failed to fetch assets: ${response.statusText}`);
    return false; // Indicate failure
  }

  assetDatabase = await response.json();

  if (!assetDatabase || !assetDatabase.result.items || assetDatabase.result.items.length === 0) {
    console.log('No assets found for the given page.');
    return false; // Indicate no data found
  }

  console.log(`Fetched ${assetDatabase.result.items.length} assets.`);
  assetLastCheckedIndex = 0; // Reset the index for new data
  return true; // Indicate success
}

async function getNewTokenId() {
  try {
    if (!assetDatabase || !assetDatabase.result.items || assetDatabase.result.items.length === 0) {
      console.error('Asset database is empty or not initialized.');
      return 0;
    }

    for (let i = assetLastCheckedIndex; i < assetDatabase.result.items.length; i++) {
      const tokenId = assetDatabase.result.items[i].id;

      console.log("Checking Token ID: ", tokenId);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          "jsonrpc": "2.0",
          "id": 1,
          "method": "getTokenLargestAccounts",
          "params": [tokenId],
        }),
      });

      if (!response.ok) {
        console.error(`Failed to fetch token largest accounts: ${response.statusText}`);
        continue; // Skip this token and move to the next
      }

      const data = await response.json();

      if (!data.result || !data.result.value || data.result.value.length < 2) {
        console.error('Invalid data structure for largest accounts.');
        continue; // Skip this token and move to the next
      }

      const secondUiAmount = data.result.value[1].uiAmount;

      console.log(`Token ID: ${tokenId}, Second uiAmount: ${secondUiAmount}`);

      if (secondUiAmount < 1) {
        console.log("Found Token to Buy:", tokenId);
        assetLastCheckedIndex = i + 1; // Save the next position to start from
        return tokenId; // Return the token ID
      }

      await sleep(1000); // Wait 1 second to comply with TOS
    }

    console.log("No suitable token found in this iteration.");
    return 0; // Return 0 if no token meets the condition
  } catch (error) {
    console.error('Error in getNewTokenId:', error);
    return 0; // Return a default value in case of an error
  }
}

async function buyToken(tokenId) {
  console.log(`Buying Token ID: ${tokenId} at ${new Date().toISOString()}`);
  // Add your buy logic here
}

async function countdownAndWait(ms) {
  let secondsLeft = Math.ceil(ms / 1000);
  while (secondsLeft > 0) {
    process.stdout.write(`\r${secondsLeft} seconds to wait until next buy.`); // Overwrite the countdown line
    const interval = Math.min(5, secondsLeft); // Update every 5 seconds or less
    await sleep(interval * 1000);
    secondsLeft -= interval;
  }
  process.stdout.write('\rCountdown complete!                                   \n'); // Clear the countdown line
}

const swapWithRetry = async (swapFunction, ...args) => {
  let delay = RETRY_DELAY;
  console.log(`Buying Token ID: ${TOKEN_ADDR} at ${new Date().toISOString()}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
          const result = await swapFunction(...args);
          return result;
      } catch (error) {
          if (error.response && error.response.status === 429) {
              console.warn(`Rate limit exceeded. Retrying after ${delay} ms... (Attempt ${attempt} of ${MAX_RETRIES})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2; // Exponential backoff
          } else {
              throw error;
          }
      }
  }

  throw new Error('Max retries exceeded. Unable to complete swap.');
};

const getTokenBalance = async (connection, owner, tokenAddr) => {
  const defaultResult = 350000;
  try {
      const response = await connection.getTokenAccountsByOwner(owner, { mint: new PublicKey(tokenAddr) });

      if (response.value.length === 0) {
          console.error(`No token accounts found for owner: ${owner.toBase58()} and token address: ${tokenAddr}`);
          throw new Error('No token accounts found');
      }

      const info = await connection.getTokenAccountBalance(response.value[0].pubkey);

      if (info.value.uiAmount == null) {
          console.error(`No balance found for account: ${response.value[0].pubkey.toBase58()}`);
          throw new Error('No balance found');
      }

      return info.value.uiAmount;
  } catch (e) {
      console.error("Error getting token balance:", e);
      return defaultResult; // Return default value in case of error
  }
};

async function swap(tokenIn, tokenOut, solanaTracker, keypair, connection, amount) {
  console.log(`Buying Token ID: ${TOKEN_ADDR} at ${new Date().toISOString()}`);
  const swapResponse = await solanaTracker.getSwapInstructions(
    tokenIn, // From Token
    tokenOut, // To Token
    amount, // Amount to swap
    SLIPPAGE, // Slippage
    keypair.publicKey.toBase58(), // Payer public key
    FEES, // Priority fee (Recommended while network is congested) => you can adapt to increase / decrease the speed of your transactions
    false // Force legacy transaction for Jupiter
  );
  
  try {
      console.log("Send swap transaction...");

      const tx = await performSwap(swapResponse, keypair, connection, amount, tokenIn, {
          sendOptions: { skipPreflight: true },
          confirmationRetries: 30,
          confirmationRetryTimeout: 1000,
          lastValidBlockHeightBuffer: 150,
          resendInterval: 1000,
          confirmationCheckInterval: 1000,
          skipConfirmationCheck: true
      });
      console.log("Transaction ID:", tx);
      console.log("Transaction URL:", `https://solscan.io/tx/${tx}`);
      return tx;

  } catch (e) {
      console.log("Error when trying to swap");
      throw e;
  }
}

async function main() {
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  console.log("Keypair initialized successfully.");
  console.log("Public Key:", keypair.publicKey.toBase58());
  let solanaTracker = new SolanaTracker(keypair, RPC_URLS[0]);
  let connection = new Connection(RPC_URLS[0], "confirmed");

  let rpcIndex = 0;
  while (true) {
    let nextTime;
    const now = new Date();

    // Calculate time to wait based on mode
    if (mode === 'hour') {
      const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
      nextTime = nextHour - now;
      console.log(`Mode: Hourly. Time to next full hour: ${Math.ceil(nextTime / 1000)} seconds`);
    } else if (mode === 'minute') {
      const nextMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);
      nextTime = nextMinute - now;
      console.log(`Mode: Minutely. Time to next full minute: ${Math.ceil(nextTime / 1000)} seconds`);
    }

    // Wait until the next full hour or minute
    await countdownAndWait(nextTime);

    // Fetch a new dataset if needed
    if (!assetDatabase || assetLastCheckedIndex >= assetDatabase.result.items.length) {
      const fetched = await getAssetsByAuthority();
      if (!fetched) {
        console.log("No more assets to process. Stopping.");
        break;
      }
      pageCounter++;
    }

    try {
      TOKEN_ADDR = await getNewTokenId();
      if (TOKEN_ADDR !== 0) {
        // Buy
        const buyPromises = Array(4).fill(null).map(() => swapWithRetry(swap, SOL_ADDR, TOKEN_ADDR, solanaTracker, keypair, connection, SOL_BUY_AMOUNT));
        await Promise.all(buyPromises);
      } else {
        console.log("No valid token found for this interval.");
      }

      // // Sell
      // const balance = Math.round(await getTokenBalance(connection, keypair.publicKey, TOKEN_ADDR));
      // if (balance > 0) {
      //     await swapWithRetry(swap, TOKEN_ADDR, SOL_ADDR, solanaTracker, keypair, connection, balance);
      // } else {
      //     console.warn("Skipping sell operation due to zero balance.");
      // }
    } catch (error) {
      console.error("Error in main loop:", error);

      // Switch to the next RPC URL on error
      rpcIndex = (rpcIndex + 1) % RPC_URLS.length;
      const newRpcUrl = RPC_URLS[rpcIndex];
      console.log(`Switching to RPC URL: ${newRpcUrl}`);
      connection = new Connection(newRpcUrl, "confirmed");
      solanaTracker = new SolanaTracker(keypair, newRpcUrl);
    }
  }
}

main().catch(error => {
  console.error("An error occurred:", error);
});
