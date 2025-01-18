const fs = require('fs');

// Load private key from credentials file
let privateKey;
let heliusApiKey;
try {
    const credentials = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'));
    privateKey = credentials.privateKey;
    heliusApiKey = credentials.heliusApiKey;
} catch (error) {
    console.error("Failed to load private key:", error.message);
    process.exit(1);
}

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

async function main() {
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

    // Find the next token to buy
    const newTokenId = await getNewTokenId();
    if (newTokenId !== 0) {
      await buyToken(newTokenId); // Buy the token
    } else {
      console.log("No valid token found for this interval.");
    }
  }
}

main().catch(error => {
  console.error("An error occurred:", error);
});
