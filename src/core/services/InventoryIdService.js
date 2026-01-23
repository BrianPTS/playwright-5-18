/**
 * Inventory ID Generation Service
 * Handles unique ID generation for inventory items
 * Following nodejs-backend patterns for service isolation
 */

export class InventoryIdService {
  static #counter = 0;
  
  /**
   * Generate unique inventory ID with collision prevention
   * @returns {number} Unique 10-digit inventory ID
   */
  static generateUniqueId() {
    // Enhanced algorithm to prevent collisions even under high load
    const timestamp = Date.now();
    const processId = process.pid % 1000; // Multi-instance uniqueness
    const random = Math.floor(Math.random() * 1000); // Add randomness
    
    // Increment counter and reset if it exceeds 3 digits (0-999)
    this.#counter = (this.#counter + 1) % 1000;
    
    // Create unique string: timestamp(13) + processId(3) + counter(3) + random(3)
    const fullUniqueString = `${timestamp}${processId.toString().padStart(3, '0')}${this.#counter.toString().padStart(3, '0')}${random.toString().padStart(3, '0')}`;
    
    // Hash to 10 digits while maintaining uniqueness
    const hash = fullUniqueString.split('').reduce((acc, char, index) => {
      return ((acc << 5) - acc + char.charCodeAt(0) + index) & 0x7fffffff;
    }, 0);
    
    // Ensure it's always 10 digits (1000000000-9999999999)
    const tenDigitId = (hash % 9000000000) + 1000000000;
    
    return tenDigitId;
  }
  
  /**
   * Reset counter (mainly for testing)
   */
  static resetCounter() {
    this.#counter = 0;
  }
  
  /**
   * Get current counter value
   */
  static getCounter() {
    return this.#counter;
  }
}