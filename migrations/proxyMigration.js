import { Proxy } from '../models/proxyModel.js';
import connectDB from '../config/db.js';
import proxyArray from '../helpers/proxy.js';

/**
 * Migration script to populate the proxy database from existing proxy.js file
 */

const migrateProxies = async () => {
  try {
    await connectDB();
    console.log('Connected to database for proxy migration');
    
    // Clear existing proxies (optional - comment out if you want to keep existing data)
    // await Proxy.deleteMany({});
    // console.log('Cleared existing proxies');
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Get proxy array - handle both old and new formats
    let proxies = [];
    if (proxyArray && proxyArray.proxies) {
      proxies = proxyArray.proxies;
    } else if (Array.isArray(proxyArray)) {
      proxies = proxyArray;
    } else {
      console.error('Invalid proxy array format:', proxyArray);
      return;
    }
    
    console.log(`Processing ${proxies.length} proxies...`);
    
    for (const proxyData of proxies) {
      try {
        let proxyInfo;
        
        // Handle different proxy formats
        if (typeof proxyData === 'string') {
          // Raw format: "ip:port:username:password"
          proxyInfo = Proxy.parseRawProxy(proxyData);
        } else if (proxyData.server && proxyData.username && proxyData.password) {
          // Object format: {server: "ip:port", username: "user", password: "pass"}
          const [ip, port] = proxyData.server.split(':');
          proxyInfo = {
            proxy_id: `${ip}_${port}`,
            server: proxyData.server,
            ip: ip,
            port: parseInt(port),
            username: proxyData.username,
            password: proxyData.password,
            raw_proxy_string: `${ip}:${port}:${proxyData.username}:${proxyData.password}`
          };
        } else {
          throw new Error(`Invalid proxy format: ${JSON.stringify(proxyData)}`);
        }
        
        // Check if proxy already exists
        const existingProxy = await Proxy.findOne({ proxy_id: proxyInfo.proxy_id });
        if (existingProxy) {
          console.log(`Proxy ${proxyInfo.proxy_id} already exists, skipping`);
          continue;
        }
        
        // Create new proxy with additional metadata
        const newProxy = new Proxy({
          ...proxyInfo,
          provider: 'imported_from_file',
          status: 'active',
          is_working: true,
          tags: ['imported', 'legacy']
        });
        
        await newProxy.save();
        successCount++;
        
        if (successCount % 50 === 0) {
          console.log(`Processed ${successCount} proxies...`);
        }
        
      } catch (error) {
        errorCount++;
        errors.push({
          proxy: proxyData,
          error: error.message
        });
        console.error(`Error processing proxy ${JSON.stringify(proxyData)}: ${error.message}`);
      }
    }
    
    console.log('\n=== Migration Complete ===');
    console.log(`✅ Successfully migrated: ${successCount} proxies`);
    console.log(`❌ Failed to migrate: ${errorCount} proxies`);
    
    if (errors.length > 0 && errors.length <= 10) {
      console.log('\nErrors:');
      errors.forEach((err, index) => {
        console.log(`${index + 1}. ${JSON.stringify(err.proxy)} - ${err.error}`);
      });
    } else if (errors.length > 10) {
      console.log(`\nToo many errors to display (${errors.length} total)`);
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
  }
};

// Run migration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateProxies()
    .then(() => {
      console.log('Migration script completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Migration script failed:', error);
      process.exit(1);
    });
}

export { migrateProxies };