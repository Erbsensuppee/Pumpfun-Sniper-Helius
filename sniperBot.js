import {  Connection, 
          Keypair, 
          PublicKey, 
          VersionedTransaction, 
          Transaction,
          sendAndConfirmTransaction,
          sendAndConfirmRawTransaction          
        } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import axios from "axios";

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

function saveCoinsToFile() {
  fs.writeFileSync("boughtCoins.json", JSON.stringify(boughtCoins, null, 2));
  console.log("Bought coins saved to file.");
}

// Store for bought coins
const boughtCoins = loadBoughtCoins();

function loadBoughtCoins() {
  if (fs.existsSync("boughtCoins.json")) {
    const data = fs.readFileSync("boughtCoins.json", "utf8");
    return JSON.parse(data);
  }
  return [];
}

// Function to remove a coin from the list based on token address
function removeBoughtCoin(tokenAddress) {
  const index = boughtCoins.findIndex(coin => coin.tokenAddress === tokenAddress);

  if (index !== -1) {
    const removedCoin = boughtCoins.splice(index, 1)[0]; // Remove the coin and keep its data
    console.log("Coin removed from the list:", removedCoin);
  } else {
    console.log(`No coin found with token address: ${tokenAddress}`);
  }
}

// Function to log a successfully sold coin
function logBoughtCoin(tokenAddress, txid) {
  const timestamp = new Date().toISOString();
  const coin = {
    tokenAddress,
    txid,
    timestamp,
  };

  boughtCoins.push(coin);

  console.log("Coin logged as bought:", coin);
}

// RPC URLs
const RPC_URLS = [
  `https://rpc-mainnet.solanatracker.io/?api_key=${solanaTrackerApiKey}`,
  `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`,
  "https://api.mainnet-beta.solana.com",
  `https://staked.helius-rpc.com/?api-key=${heliusApiKey}`
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
async function performSwap(fromToken, toToken, amount, payer, slippage, forceLegacy = true, priorityFee = "5e-7") {
  const API_ENDPOINT = "https://swap-v2.solanatracker.io/swap";
  //const API_ENDPOINT = "https://swap-api.solanatracker.io/swap"
  
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
    // Refresh blockhash before each attempt
    txn.recentBlockhash = (
      await connection.getLatestBlockhash("confirmed")
    ).blockhash;

    txn.sign(keypair);

    if (txn instanceof VersionedTransaction) {
      // Sign and send versioned transaction
      try {
        console.log(`Buying Token ID: ${TOKEN_ADDR} at ${new Date().toISOString()}`);
        txid = await connection.sendRawTransaction(txn.serialize(), {
          skipPreflight: false,
        });       
      } catch (error) {
        console.error("Error send Raw Transaction " + error);
      }
    } else if (txn instanceof Transaction) {
      // Sign and send legacy transaction
      try {
        const rawTransaction = txn.serialize();
        console.log(`Buying Token ID: ${TOKEN_ADDR} at ${new Date().toISOString()}`);
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

/**
 * Handles a buy or sell transaction for a specified token on the Solana network.
 *
 * @param {"buy"|"sell"} action - The action to perform: "buy" to purchase the token, "sell" to liquidate it.
 * @param {string} TOKEN_ADDR - The address of the token to buy or sell.
 * @returns {Promise<void>} - Resolves when the transaction process is complete. Logs results or errors.
 *
 * @description
 * This function performs a token transaction on the Solana blockchain. It supports both
 * "buy" and "sell" actions, dynamically adjusting the source and destination addresses
 * based on the action. The function includes retry logic, polling for confirmation, and
 * detailed error handling to ensure robust execution.
 *
 * Steps:
 * 1. Configures transaction parameters based on the `action` ("buy" or "sell").
 * 2. Initiates a swap using the `performSwap` function.
 * 3. Deserializes the transaction and attempts to send it to the network.
 * 4. Implements polling to check the transaction status (processed, confirmed, finalized).
 * 5. Handles and logs errors such as transaction failure or slippage issues.
 *
 * Example Usage:
 * ```javascript
 * // Perform a buy transaction
 * await handleTransaction("buy", "TOKEN_ADDR_HERE");
 *
 * // Perform a sell transaction
 * await handleTransaction("sell", "TOKEN_ADDR_HERE");
 * ```
 *
 * Note:
 * - The function requires a valid `TOKEN_ADDR` and assumes that `performSwap`, `sendTransaction`,
 *   and other supporting functions are correctly implemented and available in the scope.
 */
async function handleTransaction(action, TOKEN_ADDR) {
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  let connection = new Connection(RPC_URLS[1], "confirmed");
  console.log("Keypair initialized successfully.");
  console.log("Public Key:", keypair.publicKey.toBase58());

  if (TOKEN_ADDR === 0) {
    console.error("Invalid token address.");
    return;
  }

  try {
    const forceLegacy = true;
    const priorityFee = 0.001;

    // Determine swap direction based on action
    const [fromAddr, toAddr, amount] = action === "buy"
      ? [SOL_ADDR, TOKEN_ADDR, SOL_BUY_AMOUNT] // Buy logic
      : [TOKEN_ADDR, SOL_ADDR, "100%"];       // Sell logic

    console.log(`Performing ${action.toUpperCase()} for token: ${TOKEN_ADDR}`);

    // Perform the swap
    const swapResult = await performSwap(fromAddr, toAddr, amount, keypair.publicKey.toBase58(), SLIPPAGE, forceLegacy, priorityFee);

    // Deserialize the transaction
    const txn = deserializeTransaction(swapResult);
    if (!txn) {
      console.error("Failed to deserialize transaction.");
      return;
    }

    const maxRetries = 1; // Max retry attempts
    let retryInterval = 2000; // Start with 2 seconds
    let attempt = 0;
    let confirmed = false;
    let txid = null;

    while (attempt < maxRetries && !confirmed) {
      try {
        // Send the transaction
        txid = await sendTransaction(txn, keypair, connection);
        console.log(`Transaction sent. Attempt ${attempt + 1}: ${txid}`);

        // Poll for transaction confirmation
        const maxPollTime = 300000; // 300 seconds (5 minutes)
        const pollInterval = 2000; // Poll every 2 seconds
        let elapsedTime = 0;

        console.log("Polling for transaction confirmation...");
        while (elapsedTime < maxPollTime) {
          const status = await connection.getSignatureStatus(txid, { searchTransactionHistory: true });

          if (status?.value?.confirmationStatus === "confirmed" || status?.value?.confirmationStatus === "finalized") {
            console.log(`Transaction confirmed: ${txid}`);
            switch (action) {
              case "buy":
                logBoughtCoin(TOKEN_ADDR, txid);
                break;
              case "sell":
                removeBoughtCoin(TOKEN_ADDR);
                break;
              default:
                console.log("Unknown action in handleTransaction")
                break;
            }
            saveCoinsToFile();
            confirmed = true;
            break;
          } else if (status?.value?.confirmationStatus === "processed") {
            console.log(`Transaction is still being processed: ${txid}`);
          } else if (status?.value?.err) {
            console.error(`Transaction failed with error: ${JSON.stringify(status.value.err)}`);

            // Fetch transaction details and logs for debugging
            const transactionDetails = await connection.getTransaction(txid, { commitment: "confirmed" });
            if (transactionDetails?.meta?.logMessages) {
              console.error("Transaction Logs:");
              transactionDetails.meta.logMessages.forEach(log => console.error(log));
            } else {
              console.error("No logs available for this transaction.");
            }

            break; // Exit polling if there's an error
          } else {
            console.log(`Transaction not found or not confirmed yet. TxID: ${txid}`);
          }

          // Wait for the next poll
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          elapsedTime += pollInterval;
        }

        if (!confirmed) {
          console.error(`Transaction not confirmed within ${maxPollTime / 1000} seconds: ${txid}`);

          // Fetch additional details for debugging
          const transactionDetails = await connection.getTransaction(txid, { commitment: "confirmed" });
          if (transactionDetails) {
            console.error("Transaction Details:", transactionDetails);
            console.error("Logs:", transactionDetails.meta?.logMessages || "No logs available.");
          } else {
            console.error("Transaction not found on the blockchain.");
          }
        }
      } catch (retryError) {
        console.error(`Error on attempt ${attempt + 1}:`, retryError.message);
      }

      attempt++;
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval *= 1.5; // Increase the interval by 50% after each attempt
    }
  } catch (error) {
    console.error(`Error during ${action} transaction:`, error.message);
  }
}


async function main() {
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
    //TOKEN_ADDR = await getNewTokenId();
    TOKEN_ADDR = "8k81MK4iUH756x3qhbRk72fuCjT731Wny7tVVdxKpump";
    if (TOKEN_ADDR !== 0) {
      try {
        await handleTransaction("sell", TOKEN_ADDR);
      } catch (error) {
        console.log("Error: handleTransaction handler "+ error)
      }
    }
  }
}

main().catch(error => {
  console.error("An error occurred:", error);
});
