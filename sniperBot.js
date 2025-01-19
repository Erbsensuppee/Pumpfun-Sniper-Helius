import { Connection, Keypair, PublicKey, VersionedTransaction, Transaction } from "@solana/web3.js";
import { SolanaTracker } from "solana-swap";
//import { performSwap, SOL_ADDR } from "./lib.js";
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
  `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`,
  "https://api.mainnet-beta.solana.com"
];

// Configuration Variables
const RPC_URL = "https://api.mainnet-beta.solana.com"; // Replace with your preferred RPC endpoint
const PRIVKEY = privateKey; // Replace with your actual private key
const SOL_ADDR = "So11111111111111111111111111111111111111112"
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

import axios from "axios";

/**
 * Perform a swap using Solana Tracker Swap API.
 * @param {string} fromToken - The mint address of the token you are swapping from (e.g., SOL).
 * @param {string} toToken - The mint address of the token you are swapping to.
 * @param {number} amount - The amount of the `fromToken` to swap.
 * @param {string} payer - The Base58 encoded public key of the payer's wallet.
 * @param {string} slippage - Slippage tolerance in percentage (e.g., 0.5 for 0.5%).
 * @param {boolean} forceLegacy - Whether to force legacy transaction format.
 * @param {string} priorityFee - Priority fee to include with the transaction.
 * @returns {Promise<object>} - The API response including transaction details.
 */
async function performSwap(fromToken, toToken, amount, payer, slippage, forceLegacy = false, priorityFee = "5e-7") {
  const API_ENDPOINT = "https://swap-v2.solanatracker.io/swap";
  
  try {
    // Build the payload
    const payload = {
      from: fromToken,
      to: toToken,
      fromAmount: amount,
      slippage,
      payer,
      forceLegacy,
      priorityFee
    };

    // Send the request to the Swap API
    const response = await axios.post(API_ENDPOINT, payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Check for successful response
    if (response.status === 200) {
      console.log("Swap successful:", response.data);
      return response.data; // Return transaction details
    } else {
      console.error("Swap failed with status:", response.status, response.statusText);
      return null;
    }
  } catch (error) {
    console.error("Error performing swap:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    throw error;
  }
}

/**
 * Processes a transaction response and deserializes it.
 * @param {object} responseData - The API response containing transaction details.
 * @returns {Transaction|VersionedTransaction|null} - The deserialized transaction object or null if deserialization fails.
 */
function deserializeTransaction(responseData) {
  try {
    if (!responseData || !responseData.txn) {
      console.error("Invalid response data: Missing 'txn' field.");
      return null;
    }

    // Deserialize the transaction from the base64 string
    const serializedTransactionBuffer = Buffer.from(responseData.txn, "base64");
    let txn;

    if (responseData.type === "v0") {
      txn = VersionedTransaction.deserialize(serializedTransactionBuffer);
    } else {
      txn = Transaction.from(serializedTransactionBuffer);
    }

    if (!txn) {
      console.error("Failed to deserialize the transaction.");
      return null;
    }

    console.log("Transaction deserialized successfully.");
    return txn;
  } catch (error) {
    console.error("Error during transaction deserialization:", error.message);
    return null;
  }
}

/**
 * Sends a Solana transaction to the network.
 * @param {Transaction|VersionedTransaction} txn - The deserialized transaction to send.
 * @param {Keypair} keypair - The sender's keypair to sign the transaction.
 * @param {Connection} connection - Solana connection object.
 * @returns {Promise<string|null>} - The transaction ID or null if sending fails.
 */
async function sendTransaction(txn, keypair, connection) {
  try {
    let txid;

    // Check if the transaction is versioned or legacy
    if (txn instanceof VersionedTransaction) {
      // Sign and send versioned transaction
      txn.sign([keypair]);
      try {
        txid = await connection.sendRawTransaction(txn.serialize(), {
          skipPreflight: false,
        });       
      } catch (error) {
        console.error("Error send Raw Transaction " + error);
      }
    } else if (txn instanceof Transaction) {
      // Sign and send legacy transaction
      txn.sign(keypair);
      try {
        const rawTransaction = txn.serialize();
        txid = await connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
        });
      } catch (error) {
        console.error("Error send Raw Transaction " + error);
      }
    } else {
      throw new Error("Invalid transaction type");
    }
    return txid;
  } catch (error) {
    console.error("Error sending transaction:", error.message);
    return null;
  }
}

async function main() {
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  console.log("Keypair initialized successfully.");
  console.log("Public Key:", keypair.publicKey.toBase58());
  let solanaTracker = new SolanaTracker(keypair, RPC_URLS[0]);
  let connection = new Connection(RPC_URLS[2], "confirmed");

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
    // TOKEN_ADDR = await getNewTokenId();
    TOKEN_ADDR = "6e4L6gZ3qEZGymNNJ4B5X5KUy5rFG2oQoCrrCmnUpump"
    if (TOKEN_ADDR !== 0) {
      try {
        const forceLegacy = false;
        const priorityFee = 0.0001;
    
        // Perform the swap
        const swapResult = await performSwap(SOL_ADDR, TOKEN_ADDR, SOL_BUY_AMOUNT, keypair.publicKey, SLIPPAGE, forceLegacy, priorityFee);
        console.log("Swap Result:", swapResult);
    
        // Deserialize the transaction
        const txn = deserializeTransaction(swapResult);
        if (txn) {
          console.log("Deserialized Transaction:", txn);
    
          const maxRetries = 5; // Max retry attempts
          const retryInterval = 3000; // 3 seconds between retries
          let attempt = 0;
          let confirmed = false;
    
          while (attempt < maxRetries && !confirmed) {
            try {
              // Refresh blockhash before each attempt
              const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
              txn.recentBlockhash = blockhash;
              txn.lastValidBlockHeight = lastValidBlockHeight;
              txn.feePayer = keypair.publicKey;
              txn.sign(keypair);
    
              // Simulate transaction to ensure it’s still valid
              const simulationResult = await connection.simulateTransaction(txn);
              if (simulationResult.value.err) {
                console.error("Transaction simulation failed before retry:", simulationResult.value.err);
                break;
              }
    
              console.log("Transaction simulation successful. Attempting to send...");
    
              // Send the transaction
              const txid = await connection.sendRawTransaction(txn.serialize(), { skipPreflight: true });
              console.log(`Transaction sent. Attempt ${attempt + 1}: ${txid}`);
    
              // Check for confirmation
              const status = await connection.getSignatureStatus(txid, { searchTransactionHistory: true });
              if (status?.value?.confirmationStatus === "confirmed" || status?.value?.confirmationStatus === "finalized") {
                console.log("Transaction confirmed:", txid);
                confirmed = true;
              } else {
                console.error("Transaction not confirmed. Retrying...");
              }
            } catch (retryError) {
              console.error(`Error on attempt ${attempt + 1}:`, retryError.message);
            }
    
            attempt++;
            if (!confirmed) await new Promise(resolve => setTimeout(resolve, retryInterval)); // Wait before retrying
          }
    
          if (!confirmed) {
            console.error("Transaction failed after maximum retries.");
          }
        } else {
          console.error("Failed to process the transaction.");
        }
      } catch (error) {
        console.error("Error in transaction logic:", error.message);
      }
    }
    
    
    
    
    

    // try {
    //   TOKEN_ADDR = await getNewTokenId();
    //   if (TOKEN_ADDR !== 0) {
    //     // Buy
    //     const buyPromises = Array(4).fill(null).map(() => swapWithRetry(swap, SOL_ADDR, TOKEN_ADDR, solanaTracker, keypair, connection, SOL_BUY_AMOUNT));
    //     await Promise.all(buyPromises);
    //   } else {
    //     console.log("No valid token found for this interval.");
    //   }

    //   // // Sell
    //   // const balance = Math.round(await getTokenBalance(connection, keypair.publicKey, TOKEN_ADDR));
    //   // if (balance > 0) {
    //   //     await swapWithRetry(swap, TOKEN_ADDR, SOL_ADDR, solanaTracker, keypair, connection, balance);
    //   // } else {
    //   //     console.warn("Skipping sell operation due to zero balance.");
    //   // }
    // } catch (error) {
    //   console.error("Error in main loop:", error);

    //   // Switch to the next RPC URL on error
    //   rpcIndex = (rpcIndex + 1) % RPC_URLS.length;
    //   const newRpcUrl = RPC_URLS[rpcIndex];
    //   console.log(`Switching to RPC URL: ${newRpcUrl}`);
    //   connection = new Connection(newRpcUrl, "confirmed");
    //   solanaTracker = new SolanaTracker(keypair, newRpcUrl);
    // }
  }
}

main().catch(error => {
  console.error("An error occurred:", error);
});
