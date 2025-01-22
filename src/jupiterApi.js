import axios from "axios";

const JUPITER_V6_API = "https://quote-api.jup.ag/v6";

export async function getQuote(inputMint, outputMint, amount, slippageBps) {
    const response = await axios.get(`${JUPITER_V6_API}/quote`, {
        params: {
        inputMint,
        outputMint,
        amount,
        slippageBps,
        },
    });
    return response.data;
}
  
export async function getSwapInstructions(quoteResponse, userPublicKey) {
    const response = await axios.post(`${JUPITER_V6_API}/swap-instructions`, {
        quoteResponse,
        userPublicKey,
        wrapUnwrapSOL: true,
    });
    return response.data;
}
