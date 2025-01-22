import {
    Connection,
    Keypair,
    PublicKey
  } from "@solana/web3.js";
import {
    deserializeInstruction,
    getAddressLookupTableAccounts,
    simulateTransaction,
    createVersionedTransaction,
  } from "./transactionUtils.js";
import {
  getQuote,
  getSwapInstructions,
} from "./jupiterApi.js"
import{
  createJitoBundle,
  sendJitoBundle,
  checkBundleStatus,
  bundleSignature
} from "./jitoService.js"
import {
  getTokenBalance
} from "./getTokenBalance.js"
import bs58 from "bs58";

async function getTokenInfo(mint, connection) {
    const mintAccount = new PublicKey(mint);
    const mintInfo = await connection.getParsedAccountInfo(mintAccount);

    if (!mintInfo.value || !mintInfo.value.data || !mintInfo.value.data.parsed) {
        throw new Error(`❌ Failed to fetch token info for mint: ${mint}`);
    }

    const { decimals } = mintInfo.value.data.parsed.info;
    return { decimals };
}

async function getAveragePriorityFee(connection) {
    const priorityFees = await connection.getRecentPrioritizationFees();
    if (priorityFees.length === 0) {
      return { microLamports: 10000, solAmount: 0.00001 }; // Default to 10000 micro-lamports if no data
    }
  
    const recentFees = priorityFees.slice(-150); // Get fees from last 150 slots
    const averageFee =
      recentFees.reduce((sum, fee) => sum + fee.prioritizationFee, 0) /
      recentFees.length;
    const microLamports = Math.ceil(averageFee);
    const solAmount = microLamports / 1e6 / 1e3; // Convert micro-lamports to SOL
    return { microLamports, solAmount };
  }

export async function swap(
    inputMint,
    outputMint,
    amount,
    slippageBps = 100,
    maxRetries = 5,
    privateKey,
    connection
  ) {
    const wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    let retries = 0;
    while (retries < maxRetries) {
      try {
        console.log("\n🔄 ========== INITIATING SWAP ==========");
        console.log("🔍 Fetching token information...");
        const inputTokenInfo = await getTokenInfo(inputMint, connection);
        const outputTokenInfo = await getTokenInfo(outputMint, connection);
  
        console.log(`🔢 Input token decimals: ${inputTokenInfo.decimals}`);
        console.log(`🔢 Output token decimals: ${outputTokenInfo.decimals}`);
        let adjustedAmount = null;
        if(inputMint === "So11111111111111111111111111111111111111112"){
          adjustedAmount = amount * Math.pow(10, inputTokenInfo.decimals);
        }else{
          adjustedAmount  = await getTokenBalance(connection, wallet.publicKey ,inputMint);
        }
        const adjustedSlippageBps = slippageBps * (1 + retries * 0.5);
  
        // 1. Get quote from Jupiter
        console.log("\n💰 Getting quote from Jupiter...");
        const quoteResponse = await getQuote(
          inputMint,
          outputMint,
          adjustedAmount,
          adjustedSlippageBps
        );
  
        if (!quoteResponse || !quoteResponse.routePlan) {
          throw new Error("❌ No trading routes found");
        }
  
        console.log("✅ Quote received successfully");
  
        // 2. Get swap instructions
        console.log("\n📝 Getting swap instructions...");
        const swapInstructions = await getSwapInstructions(
          quoteResponse,
          wallet.publicKey.toString()
        );
  
        if (!swapInstructions || swapInstructions.error) {
          throw new Error(
            "❌ Failed to get swap instructions: " +
              (swapInstructions ? swapInstructions.error : "Unknown error")
          );
        }
  
        console.log("✅ Swap instructions received successfully");
  
        const {
          setupInstructions,
          swapInstruction: swapInstructionPayload,
          cleanupInstruction,
          addressLookupTableAddresses,
        } = swapInstructions;
  
        const swapInstruction = deserializeInstruction(swapInstructionPayload);
  
        // 3. Prepare transaction
        console.log("\n🛠️  Preparing transaction...");
        const addressLookupTableAccounts = await getAddressLookupTableAccounts(
          addressLookupTableAddresses,
          connection
        );
  
        const latestBlockhash = await connection.getLatestBlockhash("finalized");
  
        // 4. Simulate transaction to get compute units
        const instructions = [
          ...setupInstructions.map(deserializeInstruction),
          swapInstruction,
        ];
  
        if (cleanupInstruction) {
          instructions.push(deserializeInstruction(cleanupInstruction));
        }
  
        console.log("\n🧪 Simulating transaction...");
        const computeUnits = await simulateTransaction(
          instructions,
          wallet.publicKey,
          addressLookupTableAccounts,
          5,
          connection
        );
  
        if (computeUnits === undefined) {
          throw new Error("❌ Failed to simulate transaction");
        }
  
        if (computeUnits && computeUnits.error === "InsufficientFundsForRent") {
          console.log("❌ Insufficient funds for rent. Skipping this swap.");
          return null;
        }
  
        const priorityFee = await getAveragePriorityFee(connection);
  
        console.log(`🧮 Compute units: ${computeUnits}`);
        console.log(`💸 Priority fee: ${priorityFee.microLamports} micro-lamports (${priorityFee.solAmount.toFixed(9)} SOL)`);
  
        // 5. Create versioned transaction
        const transaction = createVersionedTransaction(
          instructions,
          wallet.publicKey,
          addressLookupTableAccounts,
          latestBlockhash.blockhash,
          computeUnits,
          priorityFee
        );
  
        // 6. Sign the transaction
        transaction.sign([wallet]);
  
        // 7. Create and send Jito bundle
        console.log("\n📦 Creating Jito bundle...");
        const jitoBundle = await createJitoBundle(transaction, wallet, connection);
        console.log("✅ Jito bundle created successfully");
  
        console.log("\n📤 Sending Jito bundle...");
        let bundleId = await sendJitoBundle(jitoBundle);
        console.log(`✅ Jito bundle sent. Bundle ID: ${bundleId}`);
        console.log(`bundleSignature ${bundleSignature}`);

        console.log("\n🔍 Checking Signature status...");
        let bundleStatus = null;
        let bundleRetries = 3;
        const delay = 1000; // Wait 1 seconds
  
        while (bundleRetries > 0) {
          console.log(`⏳ Waiting for 1 seconds before checking status...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
  
          bundleStatus = await connection.getSignatureStatus(bundleSignature, {searchTransactionHistory: true});
  
          if (bundleStatus?.value?.confirmationStatus === "confirmed" || bundleStatus?.value?.confirmationStatus === "finalized") {
            break;
          }else if (bundleStatus?.value?.confirmationStatus === "processed") {
            console.log(`Transaction is still being processed: ${bundleSignature}`);
            break;
          }else if (bundleStatus?.value?.err){
            console.error(`Transaction failed with error: ${JSON.stringify(bundleStatus.value.err)}`);
            throw new Error("Failed to execute swap after multiple attempts.");
          } else{
            bundleRetries--;
          }  
        }
  
        console.log("\n✨ Swap executed successfully! ✨");
        console.log("========== SWAP COMPLETE ==========\n");
  
        const signature = bs58.encode(transaction.signatures[0]);
        return signature;
      } catch (error) {
        console.error(
          `\n❌ Error executing swap):`
        );
        console.error(error.message);
      }
    }
  }
