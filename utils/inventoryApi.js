import axios from 'axios';
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

/**
 * Utility class for SeatScouts inventory API operations
 */
class InventoryApi {
  constructor() {
    this.baseURL = 'https://app.seatscouts.com/sync/api';
    
    // Validate environment variables
    if (!process.env.SYNC_COMPANY_ID) {
      throw new Error('SYNC_COMPANY_ID environment variable is required');
    }
    if (!process.env.SYNC_API_TOKEN) {
      throw new Error('SYNC_API_TOKEN environment variable is required');
    }
    
    this.headers = {
      'X-Company-Id': process.env.SYNC_COMPANY_ID,
      'X-Api-Token': process.env.SYNC_API_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Delete inventory item by inventory ID (uses batch method)
   * @param {string} inventoryId - The inventory ID to delete
   * @returns {Promise<Object>} API response
   */


  /**
   * Delete multiple inventory items in batch
   * @param {Array<string>} inventoryIds - Array of inventory IDs to delete
   * @returns {Promise<Object>} Batch deletion results
   */
  async deleteInventoryBatch(inventoryIds) {
    try {
      // Debug logging for API request
      console.log(`[API DEBUG] Attempting to delete inventory batch:`, {
        url: `${this.baseURL}/inventories/delete`,
        inventoryIds: inventoryIds,
        count: inventoryIds.length,
        headers: {
          'X-Company-Id': this.headers['X-Company-Id'],
          'X-Api-Token': this.headers['X-Api-Token'] ? `${this.headers['X-Api-Token'].substring(0, 10)}...` : undefined, // Mask token for security
          'Content-Type': this.headers['Content-Type']
        }
      });

      // Additional validation before making the request
      if (!this.headers['X-Company-Id'] || !this.headers['X-Api-Token']) {
        throw new Error(`Missing API credentials: Company ID: ${!!this.headers['X-Company-Id']}, API Token: ${!!this.headers['X-Api-Token']}`);
      }

      const response = await axios.post(`${this.baseURL}/inventories/delete`, {
        inventory_ids: inventoryIds
      }, {
        headers: this.headers,
        timeout: 15000 // 15 second timeout for batch operations
      });

      console.log(`[API SUCCESS] Batch deletion request for ${inventoryIds.length} items responded with status ${response.status}.`);
      console.log('[API RESPONSE DATA]', JSON.stringify(response.data, null, 2));

      return {
        successful: inventoryIds, // Assume all successful if no error
        failed: [],
        total: inventoryIds.length,
        apiResponse: response.data
      };
    } catch (error) {
      console.error(`[API ERROR] Failed to delete inventory batch for ${inventoryIds.length} items:`, error.message);
      if (error.response) {
        console.error(`[API ERROR DETAILS] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data, null, 2)}`);
      }
      
      // Return failed result for all inventory IDs since batch deletion failed
      // No fallback to individual deletions as there's no separate single deletion API
      return {
        successful: [],
        failed: inventoryIds.map(id => ({
          id: id,
          error: error.message,
          status: error.response?.status || 'NETWORK_ERROR'
        })),
        total: inventoryIds.length
      };
    }
  }
}

export default InventoryApi;