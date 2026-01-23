import connectDB from '../config/db.js';
import { ProxyService } from '../helpers/ProxyService.js';
import { ProxyController } from '../controllers/proxyController.js';

/**
 * Example script to import your raw proxy strings
 * This demonstrates how to convert your provider format to the database
 */

// Your raw proxy strings from the provider
const rawProxyStrings = [
  "139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM",
  "139.171.135.176:6961:V6t6WYtx0m:pDdstBA9NM",
  "139.171.143.137:8962:V6t6WYtx0m:pDdstBA9NM",
  "139.171.143.138:8963:V6t6WYtx0m:pDdstBA9NM",
  "139.171.132.199:6219:V6t6WYtx0m:pDdstBA9NM",
  "139.171.137.43:7338:V6t6WYtx0m:pDdstBA9NM",
  "139.171.129.226:5481:V6t6WYtx0m:pDdstBA9NM"
  // Add more proxy strings here...
];

const importProxies = async () => {
  try {
    console.log('🔄 Starting proxy import process...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');
    
    // Import proxies with metadata
    const importResult = await ProxyService.initialize(rawProxyStrings, {
      provider: 'my_provider', // Replace with your provider name
      region: 'unknown',
      country_code: 'unknown',
      tags: ['imported_batch_1', 'residential'] // Add relevant tags
    });
    
    if (importResult.success) {
      console.log('✅ Import successful!');
      console.log('📊 Summary:', importResult.data.summary);
      
      // Show detailed results
      console.log(`\n📈 Results:`);
      console.log(`- Total processed: ${importResult.data.summary.total}`);
      console.log(`- Successfully created: ${importResult.data.summary.created}`);
      console.log(`- Already existed: ${importResult.data.summary.existing}`);
      console.log(`- Failed: ${importResult.data.summary.failed}`);
      
      // Show failed imports if any
      if (importResult.data.failed.length > 0) {
        console.log(`\n❌ Failed imports:`);
        importResult.data.failed.forEach((failure, index) => {
          console.log(`${index + 1}. ${failure.rawProxy} - ${failure.error}`);
        });
      }
      
    } else {
      console.error('❌ Import failed:', importResult.error);
    }
    
    // Get some statistics
    console.log('\n📊 Getting proxy statistics...');
    const stats = await ProxyController.getProxyStats();
    if (stats.success) {
      console.log('Database statistics:', {
        total: stats.data.overview.total,
        active: stats.data.overview.active,
        average_success_rate: Math.round(stats.data.overview.avgSuccessRate || 0) + '%'
      });
    }
    
    // Test getting available proxies
    console.log('\n🔍 Testing proxy retrieval...');
    const availableResult = await ProxyController.getAvailableProxies({ limit: 5 });
    if (availableResult.success) {
      console.log(`Found ${availableResult.data.length} available proxies`);
      
      // Show first available proxy
      if (availableResult.data.length > 0) {
        const firstProxy = availableResult.data[0];
        console.log('Sample proxy:', {
          id: firstProxy.proxy_id,
          server: firstProxy.server,
          status: firstProxy.status,
          success_rate: firstProxy.success_rate + '%'
        });
      }
    }
    
    console.log('\n✅ Import process completed successfully!');
    
  } catch (error) {
    console.error('❌ Import process failed:', error);
  } finally {
    process.exit(0);
  }
};

// Function to test a specific proxy
const testSingleProxy = async (rawProxyString) => {
  try {
    await connectDB();
    
    console.log(`🧪 Testing proxy: ${rawProxyString}`);
    
    const result = await ProxyController.createProxy(rawProxyString, {
      provider: 'test',
      tags: ['test']
    });
    
    if (result.success) {
      console.log('✅ Proxy created successfully');
      console.log('Proxy details:', {
        id: result.data.proxy_id,
        server: result.data.server,
        url: `http://${result.data.username}:${result.data.password}@${result.data.server}`
      });
    } else {
      console.error('❌ Failed to create proxy:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
};

// Function to query existing proxies
const queryProxies = async () => {
  try {
    await connectDB();
    
    console.log('🔍 Querying existing proxies...');
    
    const result = await ProxyController.getAllProxies({}, {
      limit: 10,
      sortBy: 'success_rate',
      sortOrder: 'desc'
    });
    
    if (result.success) {
      console.log(`Found ${result.total} total proxies (showing ${result.data.length})`);
      
      result.data.forEach((proxy, index) => {
        console.log(`${index + 1}. ${proxy.proxy_id} - Status: ${proxy.status} - Success Rate: ${proxy.success_rate}%`);
      });
    } else {
      console.error('❌ Query failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Query failed:', error);
  } finally {
    process.exit(0);
  }
};

// Run different commands based on arguments
const command = process.argv[2];

switch (command) {
  case 'import':
    importProxies();
    break;
  case 'test':
    const testProxy = process.argv[3];
    if (!testProxy) {
      console.error('❌ Please provide a proxy string to test');
      console.log('Usage: node importProxies.js test "139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM"');
      process.exit(1);
    }
    testSingleProxy(testProxy);
    break;
  case 'query':
    queryProxies();
    break;
  default:
    console.log('🚀 Proxy Management Script');
    console.log('Usage:');
    console.log('  node importProxies.js import         - Import all proxy strings');
    console.log('  node importProxies.js test "proxy"   - Test a single proxy string');
    console.log('  node importProxies.js query          - Query existing proxies');
    break;
}

export { importProxies, testSingleProxy, queryProxies };