#!/usr/bin/env node

/**
 * Enable Events for Scraping
 * Sets Skip_Scraping to false for specified number of events
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/db.js';

// Load environment variables
dotenv.config();

async function enableEventsForScraping() {
  console.log('🔧 Enabling Events for Scraping...\n');
  
  try {
    // Connect to database
    console.log('📡 Connecting to MongoDB...');
    await connectDB();
    
    // Import Event model
    const { Event } = await import('./models/index.js');
    
    // Get current status
    const totalEvents = await Event.countDocuments();
    const activeEvents = await Event.countDocuments({ Skip_Scraping: { $ne: true } });
    const skippedEvents = await Event.countDocuments({ Skip_Scraping: true });
    
    console.log('📊 Current Status:');
    console.log(`   Total Events: ${totalEvents}`);
    console.log(`   Active Events: ${activeEvents}`);
    console.log(`   Skipped Events: ${skippedEvents}\n`);
    
    if (activeEvents > 0) {
      console.log('✅ You already have active events! No changes needed.');
      return;
    }
    
    if (totalEvents === 0) {
      console.log('⚠️ No events found in database. Please add events first.');
      return;
    }
    
    // Get some events to enable (first 5 events)
    const eventsToEnable = await Event.find({ Skip_Scraping: true })
      .select('Event_ID Event_Name Event_DateTime')
      .limit(5)
      .lean();
    
    console.log(`🎯 Enabling ${eventsToEnable.length} events for scraping:\n`);
    
    for (const event of eventsToEnable) {
      console.log(`   📅 ${event.Event_ID}: ${event.Event_Name}`);
      console.log(`      Date: ${new Date(event.Event_DateTime).toLocaleString()}`);
    }
    
    console.log('\n🔄 Updating events...');
    
    // Enable the selected events
    const result = await Event.updateMany(
      { _id: { $in: eventsToEnable.map(e => e._id) } },
      { $set: { Skip_Scraping: false } }
    );
    
    console.log(`✅ Updated ${result.modifiedCount} events\n`);
    
    // Verify the change
    const newActiveEvents = await Event.countDocuments({ Skip_Scraping: { $ne: true } });
    const newSkippedEvents = await Event.countDocuments({ Skip_Scraping: true });
    
    console.log('📊 Updated Status:');
    console.log(`   Total Events: ${totalEvents}`);
    console.log(`   Active Events: ${newActiveEvents}`);
    console.log(`   Skipped Events: ${newSkippedEvents}`);
    
    if (newActiveEvents > 0) {
      console.log('\n🎉 Success! Events are now ready for scraping.');
      console.log('✅ Your scraper should now be able to find active events.');
    } else {
      console.log('\n❌ Something went wrong. No active events found after update.');
    }
    
  } catch (error) {
    console.error('\n❌ Failed to enable events!');
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Database connection closed');
  }
}

// Handle arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npm run enable-events [options]

Options:
  --all     Enable all events for scraping
  --count N Enable N number of events (default: 5)
  --help    Show this help message

Examples:
  npm run enable-events           # Enable 5 events
  npm run enable-events -- --all # Enable all events
  npm run enable-events -- --count 10  # Enable 10 events
`);
  process.exit(0);
}

if (args.includes('--all')) {
  // Modify function to enable all events
  enableEventsForScraping = async function() {
    console.log('🔧 Enabling ALL Events for Scraping...\n');
    
    try {
      await connectDB();
      const { Event } = await import('./models/index.js');
      
      const result = await Event.updateMany(
        { Skip_Scraping: true },
        { $set: { Skip_Scraping: false } }
      );
      
      console.log(`✅ Enabled ${result.modifiedCount} events for scraping`);
      
      const activeEvents = await Event.countDocuments({ Skip_Scraping: { $ne: true } });
      console.log(`📊 Total active events: ${activeEvents}`);
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  };
}

// Run the function
enableEventsForScraping().catch(console.error);