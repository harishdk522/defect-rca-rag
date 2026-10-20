/**
 * Normalizes embedding vectors to unit length for consistent similarity calculations
 * @param {Array} embedding - The embedding vector to normalize
 * @returns {Array} - The normalized embedding vector
 */
function normalizeEmbedding(embedding) {
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return embedding;
    return embedding.map(val => val / magnitude);
}

module.exports = {
    normalizeEmbedding
};