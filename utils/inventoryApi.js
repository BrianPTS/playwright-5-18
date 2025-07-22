import axios from 'axios';

/**
 * Utility class for SeatScouts inventory API operations
 */
class InventoryApi {
  constructor() {
    this.baseURL = 'https://app.seatscouts.com/sync/api';
    this.headers = {
      'X-Company-Id': process.env.SEATSCOUTS_COMPANY_ID,
      'X-Api-Token': process.env.SEATSCOUTS_API_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Delete inventory item by inventory ID
   * @param {string} inventoryId - The inventory ID to delete
   * @returns {Promise<Object>} API response
   */
  async deleteInventory(inventoryId) {
    try {
      const response = await axios.post(`${this.baseURL}/inventories/delete`, {
        inventory_ids: [inventoryId]
      }, {
        headers: this.headers,
        timeout: 10000 // 10 second timeout
      });

      return {
        success: true,
        data: response.data,
        status: response.status
      };
    } catch (error) {
      console.error(`Failed to delete inventory ${inventoryId}:`, error.message);
      
      return {
        success: false,
        error: error.message,
        status: error.response?.status || 'NETWORK_ERROR',
        inventoryId: inventoryId
      };
    }
  }

  /**
   * Delete multiple inventory items in batch
   * @param {Array<string>} inventoryIds - Array of inventory IDs to delete
   * @returns {Promise<Object>} Batch deletion results
   */
  async deleteInventoryBatch(inventoryIds) {
    try {
      const response = await axios.post(`${this.baseURL}/inventories/delete`, {
        inventory_ids: inventoryIds
      }, {
        headers: this.headers,
        timeout: 15000 // 15 second timeout for batch operations
      });

      return {
        successful: inventoryIds, // Assume all successful if no error
        failed: [],
        total: inventoryIds.length,
        apiResponse: response.data
      };
    } catch (error) {
      console.error(`Failed to delete inventory batch:`, error.message);
      
      // If batch fails, fall back to individual deletions
      const results = {
        successful: [],
        failed: [],
        total: inventoryIds.length
      };

      // Process deletions individually as fallback
      for (const inventoryId of inventoryIds) {
        const result = await this.deleteInventory(inventoryId);
        
        if (result.success) {
          results.successful.push(inventoryId);
        } else {
          results.failed.push({
            id: inventoryId,
            error: result.error,
            status: result.status
          });
        }

        // Small delay between requests to be respectful to the API
        if (inventoryIds.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return results;
    }
  }
}

export default InventoryApi;