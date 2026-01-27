import axios from 'axios';
import dotenv from "dotenv";
import logger from './logger.js';

// Load environment variables
dotenv.config();

/**
 * Utility class for SeatScouts inventory API operations
 */
class InventoryApi {
  constructor() {
    this.baseURL = 'https://app.seatscouts.com/sync/api';
    
    // Validate required environment variables
    if (!process.env.SEATSCOUTS_COMPANY_ID) {
      throw new Error('SEATSCOUTS_COMPANY_ID environment variable is required');
    }
    if (!process.env.SEATSCOUTS_API_TOKEN) {
      throw new Error('SEATSCOUTS_API_TOKEN environment variable is required');
    }
    
    this.headers = {
      'X-Company-Id': process.env.SEATSCOUTS_COMPANY_ID,
      'X-Api-Token': process.env.SEATSCOUTS_API_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    logger.info(`InventoryApi initialized with Company ID: ${process.env.SEATSCOUTS_COMPANY_ID}`);
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
      logger.api(`Attempting to delete inventory batch:`, 'POST', `${this.baseURL}/inventories/delete`, {
        inventoryIds: inventoryIds,
        count: inventoryIds.length,
        headers: {
          'X-Company-Id': this.headers['X-Company-Id'],
          'X-Api-Token': this.headers['X-Api-Token'],
          'Content-Type': this.headers['Content-Type']
        }
      });

      const response = await axios.post(`${this.baseURL}/inventories/delete`, {
        inventory_ids: inventoryIds
      }, {
        headers: this.headers,
        timeout: 15000 // 15 second timeout for batch operations
      });

      logger.api(`Batch deletion successful`, 'POST', `${this.baseURL}/inventories/delete`, {
        status: response.status,
        data: response.data
      });

      return {
        successful: inventoryIds, // Assume all successful if no error
        failed: [],
        total: inventoryIds.length,
        apiResponse: response.data
      };
    } catch (error) {
      logger.error(`Failed to delete inventory batch: ${error.message}`, 'api', error);
      
      if (error.response) {
        logger.error(`Response status: ${error.response.status}`, 'api');
        logger.error(`Response data:`, 'api', error.response.data);
        logger.error(`Response headers:`, 'api', error.response.headers);
        
        // Special handling for authentication errors
        if (error.response.status === 401) {
          logger.error('Authentication failed - please check SEATSCOUTS_COMPANY_ID and SEATSCOUTS_API_TOKEN', 'api');
          logger.error(`Current Company ID: ${this.headers['X-Company-Id']}`, 'api');
          logger.error(`Current API Token: ${this.headers['X-Api-Token'] ? '[SET]' : '[NOT SET]'}`, 'api');
        }
      } else if (error.request) {
        logger.error('No response received from server', 'api', error.request);
      } else {
        logger.error('Request setup error', 'api', error.message);
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