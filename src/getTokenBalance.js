import { 
        PublicKey 
    } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";

export async function getTokenBalance(connection, walletPublicKey, tokenMint) {
  const tokenAccountInfo = await connection.getTokenAccountsByOwner(walletPublicKey, {
    mint: new PublicKey(tokenMint),
  });

  if (tokenAccountInfo.value.length === 0) {
    throw new Error("No token account found for the provided mint.");
  }

  const tokenAccount = tokenAccountInfo.value[0].pubkey;
  const accountInfo = await getAccount(connection, tokenAccount);

  return accountInfo.amount; // Returns the balance in the smallest units
}
