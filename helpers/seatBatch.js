import moment from "moment";
import * as fs from 'fs';
// Function to generate unique 10-digit inventory ID

// Global Filters
const GLOBAL_FILTERS = {
  inventoryType: ["Primary", "Official Platinum", "Aisle Seating","Standard","Standard Ticket","resale"], // e.g., ['primary', 'resale'] - empty means no filter, strings to check for (case-insensitive)


  inventoryStatus: ["Available"], // e.g., ['available', 'sold'] - empty means no filter, strings to check for (case-insensitive)


  description: [
    
    "Standard Ticket",
    "GA Lawn",
    "General Admission Standing",
    "Standard Admission",
    "Reserved",
    "Reserved Ticket"
    
  ], // e.g., ['obstructed view', 'aisle'] - empty means no filter, strings to check for (case-insensitive)
  accessibility: [
    // Empty array means exclude ALL accessibility seats
  ], // e.g., ['wheelchair', 'hearing'] - empty means no filter, strings to check for (case-insensitive)
  excludeAccessibility: true, // Set to true to exclude ALL accessibility seats
  excludeWheelchair: true, // Set to true to exclude wheelchair accessible seats (sections containing 'WC')
};
//it will break map into seats
function GetMapSeats(data) {
  let seatArray = [];
  if (
    data &&
    data.pages &&
    data.pages.length > 0 &&
    data.pages[0] &&
    data.pages[0].segments
  ) {
    data.pages[0].segments.map((composit) => {
      if (composit?.segments) {
        composit.segments.map((SECTION) => {
          if (SECTION.segments && SECTION.segments.length > 0)
            SECTION.segments.map((ROW) => {
              ROW.placesNoKeys.map((seat) => {
                seatArray.push({
                  section: SECTION?.name,
                  row: ROW?.name,
                  seat: seat[1],
                  seatId: seat[0],
                });
              });
            });
          else {
            // GeneralAdmission seats - assuming they might be directly under SECTION or have a different structure
            // This is a placeholder and might need adjustment based on the actual GA data structure
            if (SECTION.placesNoKeys && Array.isArray(SECTION.placesNoKeys)) {
              SECTION.placesNoKeys.map((seat) => {
                seatArray.push({
                  section: SECTION?.name,
                  row: "GA", // General Admission typically doesn't have a specific row
                  seat: seat[1], // Assuming seat number is at index 1
                  seatId: seat[0], // Assuming seat ID is at index 0
                });
              });
            } else if (SECTION.name && SECTION.id) { // Fallback if placesNoKeys is not present but section has name and id
                seatArray.push({
                    section: SECTION?.name,
                    row: "GA",
                    seat: "GA", // Placeholder for seat number if not available
                    seatId: SECTION?.id, // Use section id as seatId if specific seatId is not available
                });
            }
            // console.log("Processing General Admission for SECTION:", SECTION);
          }
        });
      }
    });
  }

  return seatArray;
}
function breakArray(arr) {
  let result = [];
  let subarray = [arr[0]];

  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i] + 1 !== arr[i + 1]) {
      result.push(subarray);
      subarray = [arr[i + 1]];
    } else {
      subarray.push(arr[i + 1]);
    }
  }

  result.push(subarray);
  return result;
}

function CreateConsicutiveSeats(data) {
  const mergedData = [];

  data.forEach((item) => {
    let merged = false;
    
    // Try to find an existing group that this item can be merged with
    for (let group of mergedData) {
      if (group.section === item.section &&
          group.row === item.row &&
          group.offerId === item.offerId) {
        
        // Check if seats are consecutive (either direction)
        const groupLastSeat = Math.max(...group.seats);
        const groupFirstSeat = Math.min(...group.seats);
        const itemFirstSeat = Math.min(...item.seats);
        const itemLastSeat = Math.max(...item.seats);
        
        // Check if they can be merged (consecutive) - fixed logic
        if (groupLastSeat + 1 === itemFirstSeat || itemLastSeat + 1 === groupFirstSeat) {
          group.seats.push(...item.seats);
          group.seats.sort((a, b) => a - b); // Keep seats sorted
          merged = true;
          break;
        }
      }
    }
    
    if (!merged) {
      mergedData.push({
        amount: item.amount,
        lineItemType: item.lineItemType,
        section: item.section,
        row: item.row,
        seats: [...item.seats].sort((a, b) => a - b), // Ensure seats are sorted
        offerId: item.offerId,
        accessibility: item?.accessibility,
        descriptionId: item?.descriptionId,
        attributes: item?.attributes,
      });
    }
  });

  // Second pass: try to merge any remaining consecutive groups
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < mergedData.length; i++) {
      for (let j = i + 1; j < mergedData.length; j++) {
        const group1 = mergedData[i];
        const group2 = mergedData[j];
        
        if (group1.section === group2.section &&
            group1.row === group2.row &&
            group1.offerId === group2.offerId) {
          
          const group1LastSeat = Math.max(...group1.seats);
          const group1FirstSeat = Math.min(...group1.seats);
          const group2FirstSeat = Math.min(...group2.seats);
          const group2LastSeat = Math.max(...group2.seats);
          
          // Check if they can be merged (consecutive)
          if (group1LastSeat + 1 === group2FirstSeat || group2LastSeat + 1 === group1FirstSeat) {
            group1.seats.push(...group2.seats);
            group1.seats.sort((a, b) => a - b);
            mergedData.splice(j, 1); // Remove the merged group
            changed = true;
            break;
          }
        }
      }
      if (changed) break;
    }
  }

  return mergedData;
}
function getSplitType(arr, offer) {
  var length = arr.length;

  if (
    offer &&
    offer?.ticketTypeUnsoldQualifier &&
    (offer?.ticketTypeUnsoldQualifier == "2PACKHOLD" ||
      offer?.ticketTypeUnsoldQualifier == "222PA1HOLD" ||
      offer?.ticketTypeUnsoldQualifier == "22BOGOHOLD")
  ) {
    if (length === 2) {
      return "2";
    } else if (length === 4) {
      return "2,4";
    } else if (length >= 6) {
      var numbers = Array.from(
        { length: length % 2 == 0 ? length : length - 1 },
        (_, i) => (i % 2 == 0 ? i + 2 : undefined)
      ).filter((x) => x != undefined);
      return numbers.join(",");
    } else return "2";
  } else {
    if (length === 2) {
      return "2";
    } else if (length === 3) {
      return "3";
    } else if (length === 4) {
      return "2,4";
    } else if (length >= 5) {
      var numbers = Array.from({ length: length }, (_, i) => i + 1).filter(
        (x) => x != 1
      );
      return numbers.join(",");
    } else return "1";
  }
}

// Parse hidden fees embedded in offer name/description text (e.g. "$25 Club Fee", "$10 + $15")
// Excludes amounts that match faceValue or existing charges to avoid double-counting
function parseHiddenFees(offer) {
  if (!offer) return 0;
  // Check offer name first, then join descriptions array as fallback
  const text = offer.name || (Array.isArray(offer.descriptions) ? offer.descriptions.join(' ') : '') || '';
  if (!text) return 0;
  const matches = text.match(/\$(\d+(?:\.\d{1,2})?)/g);
  if (!matches) return 0;

  // Collect known amounts to exclude (faceValue + all charge amounts)
  const knownAmounts = new Set();
  if (offer.faceValue) knownAmounts.add(Number(offer.faceValue.toFixed(2)));
  if (offer.charges && Array.isArray(offer.charges)) {
    offer.charges.forEach(c => {
      if (c.amount) knownAmounts.add(Number(Math.abs(c.amount).toFixed(2)));
    });
  }

  const faceVal = offer.faceValue || 0;
  return matches.reduce((sum, m) => {
    const amount = parseFloat(m.replace('$', ''));
    // Skip if amount matches faceValue or an existing charge (avoid double-counting)
    if (knownAmounts.has(Number(amount.toFixed(2)))) return sum;
    // Skip amounts >= faceValue — fees are always smaller than ticket price
    if (faceVal > 0 && amount >= faceVal) return sum;
    return sum + amount;
  }, 0);
}

function CreateInventoryAndLine(data, offer, event, descriptions) {

  let _descriptions = descriptions.find(
    (x) => x.descriptionId == data?.descriptionId
  );
  let allDescriptions = "";
  let isNameAdded = false;

  if (data.attributes.includes("obstructed")) {
    allDescriptions += ", Obstructed View";
    isNameAdded = true;
  }

  if (
    data?.accessibility.includes("sight") ||
    data?.accessibility.includes("hearing")
  ) {
    allDescriptions += ", deaf/hard, blind/low";
    isNameAdded = true;
  }

  if (offer?.name?.toLowerCase().includes("limited/obstructed")) {
    allDescriptions += ", Limted/Obstructed View";
    isNameAdded = true;
  } else if (offer?.name?.toLowerCase().includes("limited view")) {
    allDescriptions += ", Limited View";
    isNameAdded = true;
  }

  if (isNameAdded == false) {
    if (_descriptions) {
      _descriptions.descriptions.map((x) => {
        // need to make it better it is not good way to check
        if (x.toLowerCase().includes("side view")) {
          allDescriptions += ", Side View";
        } else if (x.toLowerCase().includes("behind")) {
          allDescriptions += ", Behind The Stage";
        } else if (x.toLowerCase().includes("rear")) {
          allDescriptions += ", Rear View Seating";
        } else if (x.toLowerCase().includes("partial")) {
          allDescriptions += ", Partial View";
        } else if (x.toLowerCase().includes("limited")) {
          allDescriptions += ", Limited View";
        } else if (x.toLowerCase().includes("obstructed")) {
          allDescriptions += ", obstructed View";
        } else if (
          x.toLowerCase().includes("deaf") ||
          x.toLowerCase().includes("blind")
        ) {
          allDescriptions += ", deaf/hard, blind/low";
        }
      });
    }
  }

  /*
  let totalCost=parseFloat(offer?.charges.reduce((total, item) => total + item.amount, 0)+offer?.faceValue);
  let totalCostWithPercentage=totalCost+(totalCost*(event?.listCostPercentage/100));
  */
  //Get Fee which won't multiply
  let singleExtraCharges = parseFloat(
    parseFloat(
      offer?.charges
        .filter((x) => x?.reason == "order_processing")
        .reduce((total, item) => total + item.amount, 0)
    ) / data?.seats.length
  );
  //let singleExtraCharges=parseFloat(parseFloat(offer?.charges.filter(x=>x?.reason=="order_processing").reduce((total, item) => total + item.amount, 0)));
  //console.log(parseFloat(parseFloat(offer?.charges.filter(x=>x?.reason=="order_processing").reduce((total, item) => total + item.amount, 0))))
  //Remove single fee's
  let repeatExtraCharges = parseFloat(
    offer?.charges
      .filter((x) => x?.reason != "order_processing")
      .reduce((total, item) => total + item.amount, 0)
  );
  //Face Value
  let faceValue = offer?.faceValue;
  let hiddenFees = parseHiddenFees(offer);
  let totalCost = singleExtraCharges + repeatExtraCharges + faceValue + hiddenFees;

  return {
    inventory: {
      quantity: data?.seats.length,
      section: data?.section,
      hideSeatNumbers: true,
      row: data?.row,
      cost: totalCost,
      seats: data?.seats,
      eventId: event.eventMappingId,
      stockType: "MOBILE_TRANSFER",
      lineType: "PURCHASE",
      seatType: "CONSECUTIVE",
      inHandDate: moment(event?.inHandDate).format("YYYY-MM-DD"), // Format: 2024-12-22
      // "notes": "+stub +geek +tnet +vivid +tevo +pick",
      notes: "-tnow -tmplus ",
      tags: "AWS",
      offerId: data?.offerId,
      splitType: offer?.inventoryType?.toLowerCase() === "resale" ? "DEFAULT": "NEVERLEAVEONE" ,
      publicNotes: "xfer" + allDescriptions,
      listPrice: totalCost,
      customSplit: getSplitType(data?.seats, offer),
      tickets: data?.seats.map((y) => {
        return {
          id: 0,
          seatNumber: y,
          notes: "string",
          cost: totalCost,
          faceValue: totalCost,
          taxedCost: totalCost,
          sellPrice: totalCost,
          stockType: "HARD",
          eventId: 0,
          accountId: 0,
          status: "AVAILABLE",
          auditNote: "string",
        };
      }),
    },
    amount: 0,
    lineItemType: "INVENTORY",
    eventId: event?.eventMappingId,
    dbId: `${data?.seats.join("")}-${data?.row}-${data?.section}-${
      event?.eventMappingId
    }`,
    seats: data?.seats,
    row: data?.row,
    section: data?.section,
  };
}

// Excluded area names for GA events (accessibility sections)
const GA_EXCLUDED_AREAS = ['WC', 'ADA', 'ACCESSIBLE', 'WHEELCHAIR', 'HANDICAP', 'COMPANION', 'MOBILITY'];

/**
 * Process GA (General Admission) facets from the area-based facet API.
 * Segregates tickets by price level and area, creates synthetic rows/seats.
 */
export const ProcessGAFacets = (gaFacetsData, event, excludeSections = null) => {
  if (!gaFacetsData || !gaFacetsData.facets || gaFacetsData.facets.length === 0) {
    return [];
  }

  const areas = gaFacetsData._embedded?.area || [];
  const ticketTypes = gaFacetsData._embedded?.tickettype || [];
  const offers = gaFacetsData._embedded?.offer || [];
  const descriptions = gaFacetsData._embedded?.description || [];
  const facets = gaFacetsData.facets;

  let returnData = [];

  // Accumulators: group by normalized GA type+price into single inventory lines
  const primaryGAAccumulator = new Map();  // primary GA/Lawn
  const resaleGAAccumulator = new Map();   // resale GA/Lawn

  // Helper: get clean row label (what shows in CSV row column)
  const getGARowLabel = (sectionName) => {
    const lower = (sectionName || '').toLowerCase();
    if (lower.includes("lawn")) return "LAWN";
    if (lower.includes("standing")) return "SRO";
    return "GA";
  };

  // Helper: get clean section label (what shows in CSV section column)
  const getGASectionLabel = (sectionName) => {
    const lower = (sectionName || '').toLowerCase();
    if (lower.includes("lawn")) return "Lawn";
    if (lower.includes("standing")) return "General Admission Standing";
    return "General Admission";
  };

  // Helper: build description tags from an offer (same logic as CreateInventoryAndLine)
  const buildDescriptions = (offer, resolvedAreas, facetDescriptionId) => {
    let allDescriptions = "";
    let isNameAdded = false;

    if (offer?.name) {
      const offerNameLower = offer.name.toLowerCase();
      if (offerNameLower.includes("limited/obstructed")) {
        allDescriptions += ", Limted/Obstructed View"; isNameAdded = true;
      } else if (offerNameLower.includes("limited view")) {
        allDescriptions += ", Limited View"; isNameAdded = true;
      } else if (offerNameLower.includes("obstructed")) {
        allDescriptions += ", Obstructed View"; isNameAdded = true;
      } else if (offerNameLower.includes("side view")) {
        allDescriptions += ", Side View"; isNameAdded = true;
      } else if (offerNameLower.includes("behind")) {
        allDescriptions += ", Behind The Stage"; isNameAdded = true;
      } else if (offerNameLower.includes("rear")) {
        allDescriptions += ", Rear View Seating"; isNameAdded = true;
      } else if (offerNameLower.includes("partial")) {
        allDescriptions += ", Partial View"; isNameAdded = true;
      }
    }

    // Look up embedded description data by facet descriptionId
    const facetDescData = facetDescriptionId
      ? descriptions.find(d => d.descriptionId === facetDescriptionId)
      : null;

    if (!isNameAdded && facetDescData && Array.isArray(facetDescData.descriptions)) {
      facetDescData.descriptions.forEach((descText) => {
        const descLower = (typeof descText === 'string' ? descText : '').toLowerCase();
        if (descLower.includes("side view")) { allDescriptions += ", Side View"; }
        else if (descLower.includes("behind")) { allDescriptions += ", Behind The Stage"; }
        else if (descLower.includes("rear")) { allDescriptions += ", Rear View Seating"; }
        else if (descLower.includes("partial")) { allDescriptions += ", Partial View"; }
        else if (descLower.includes("limited")) { allDescriptions += ", Limited View"; }
        else if (descLower.includes("obstructed")) { allDescriptions += ", obstructed View"; }
        else if (descLower.includes("deaf") || descLower.includes("blind")) { allDescriptions += ", deaf/hard, blind/low"; }
        else if (descLower.includes("uncovered")) { allDescriptions += ", Uncovered Area"; }
        else if (descLower.includes("lawn chair")) { allDescriptions += ", No Outside Lawn Chairs"; }
      });
    }

    if (!isNameAdded && offer?.descriptions && Array.isArray(offer.descriptions)) {
      offer.descriptions.forEach((desc) => {
        const descLower = (typeof desc === 'string' ? desc : desc?.description || '').toLowerCase();
        if (descLower.includes("side view")) { allDescriptions += ", Side View"; }
        else if (descLower.includes("behind")) { allDescriptions += ", Behind The Stage"; }
        else if (descLower.includes("rear")) { allDescriptions += ", Rear View Seating"; }
        else if (descLower.includes("partial")) { allDescriptions += ", Partial View"; }
        else if (descLower.includes("limited")) { allDescriptions += ", Limited View"; }
        else if (descLower.includes("obstructed")) { allDescriptions += ", obstructed View"; }
        else if (descLower.includes("deaf") || descLower.includes("blind")) { allDescriptions += ", deaf/hard, blind/low"; }
      });
    }

    if (!isNameAdded && resolvedAreas && resolvedAreas.length > 0) {
      const areaText = `${(resolvedAreas[0].description || '')} ${(resolvedAreas[0].name || '')}`.toLowerCase();
      if (areaText.includes("obstructed")) { allDescriptions += ", Obstructed View"; }
      else if (areaText.includes("limited")) { allDescriptions += ", Limited View"; }
      else if (areaText.includes("partial")) { allDescriptions += ", Partial View"; }
    }

    return allDescriptions;
  };

  // Helper: add GA/Lawn type indicator
  const addGATypeIndicator = (sectionName) => {
    const sectionLower = sectionName.toLowerCase();
    if (sectionLower.includes("lawn")) return ", GA Lawn";
    if (sectionLower.includes("standing")) return ", General Admission Standing";
    return ", General Admission";
  };

  // Helper: calculate total cost from offer charges
  const calculateCost = (offer, faceValue, seatCount) => {
    if (!offer) return faceValue;
    if (!offer.charges || !Array.isArray(offer.charges)) return faceValue + parseHiddenFees(offer);
    const orderProcessingFee = parseFloat(
      offer.charges.filter(c => c?.reason === "order_processing").reduce((t, i) => t + i.amount, 0)
    );
    const perTicketFees = parseFloat(
      offer.charges.filter(c => c?.reason !== "order_processing").reduce((t, i) => t + i.amount, 0)
    );
    const offerFaceValue = offer.faceValue || faceValue;
    const hiddenFees = parseHiddenFees(offer);
    return offerFaceValue + perTicketFees + (orderProcessingFee / seatCount) + hiddenFees;
  };

  // Helper: create inventory row
  const pushInventoryRow = (rawSection, seatCount, totalCost, offer, sellableQuantities, splitType, allDescriptions) => {
    const cleanSection = getGASectionLabel(rawSection);
    const cleanRow = getGARowLabel(rawSection);
    const seats = Array.from({ length: seatCount }, (_, i) => i + 1);
    const validSplits = sellableQuantities.filter(q => q <= seatCount);
    const customSplit = validSplits.length > 0 ? validSplits.join(',') : `${seatCount}`;

    returnData.push({
      inventory: {
        quantity: seatCount,
        section: cleanSection,
        hideSeatNumbers: true,
        row: cleanRow,
        cost: totalCost,
        seats: seats,
        eventId: event.eventMappingId,
        stockType: "MOBILE_TRANSFER",
        lineType: "PURCHASE",
        seatType: "CONSECUTIVE",
        inHandDate: moment(event?.inHandDate).format("YYYY-MM-DD"),
        notes: "-tnow -tmplus -stub",
        tags: "AWS",
        offerId: offer?.offerId || '',
        splitType: splitType,
        publicNotes: "xfer" + allDescriptions,
        listPrice: totalCost,
        customSplit: customSplit,
        tickets: seats.map((y) => ({
          id: 0, seatNumber: y, notes: "string",
          cost: totalCost, faceValue: totalCost, taxedCost: totalCost, sellPrice: totalCost,
          stockType: "HARD", eventId: 0, accountId: 0, status: "AVAILABLE", auditNote: "string",
        })),
      },
      amount: 0,
      lineItemType: "INVENTORY",
      eventId: event?.eventId,
      dbId: `${cleanRow}-${cleanSection}-${splitType}-${event?.eventId}`,
      seats: seats,
      row: cleanRow,
      section: cleanSection,
    });
  };

  facets.forEach((facet) => {
    const count = facet.count || 0;
    if (count === 0) return;

    const areaIds = facet.areas || [];
    const inventoryTypes = facet.inventoryTypes || [];
    const offerTypes = facet.offerTypes || [];
    const ticketTypeIds = facet.ticketTypes || [];
    const facetDescriptionId = facet.description || '';
    const offerIds = facet.offers || [];
    const listPriceRange = facet.listPriceRange || [];
    const isResale = inventoryTypes.some(t => t.toLowerCase() === 'resale');

    // Skip non-standard offer types
    if (offerTypes.length > 0 && !offerTypes.some(t => t.toLowerCase() === 'standard')) return;

    // Resolve area info and filter out accessibility areas
    const resolvedAreas = areaIds.map(id => areas.find(a => a.areaId === id)).filter(Boolean);
    const hasExcludedArea = resolvedAreas.some(a =>
      GA_EXCLUDED_AREAS.some(ex => a.name?.toUpperCase().includes(ex) || a.description?.toUpperCase().includes(ex))
    );
    if (hasExcludedArea) return;

    // Get section name from area
    const sectionName = resolvedAreas.length > 0
      ? resolvedAreas[0].description || resolvedAreas[0].name || 'GA'
      : 'GA';

    // For mixed events: skip areas that were already processed as reserved sections
    if (excludeSections && excludeSections.size > 0) {
      const sectionUpper = sectionName.toUpperCase();
      const isReservedSection = [...excludeSections].some(s => {
        const exUpper = s.toUpperCase();
        return sectionUpper === exUpper || sectionUpper.includes(exUpper) || exUpper.includes(sectionUpper);
      });
      if (isReservedSection) return;
    }

    const faceValue = listPriceRange.length > 0 ? listPriceRange[0].min : 0;
    // Use normalized section label for accumulation (e.g. "General Admission", "Lawn")
    const normalizedSection = getGASectionLabel(sectionName);

    // Extra info for section label disambiguation when multiple price tiers exist
    const priceLevelLabel = (facet.priceLevelSecnames && facet.priceLevelSecnames.length > 0)
      ? facet.priceLevelSecnames[0] : '';
    // Ticket type description for public notes — skip generic "Standard"/"Resale"
    const ticketTypeInfo = ticketTypeIds.length > 0 ? ticketTypes.find(t => t.ticketTypeId === ticketTypeIds[0]) : null;
    const rawTTName = (ticketTypeInfo?.name || '').trim();
    const ttLower = rawTTName.toLowerCase();
    const ticketTypeName = (rawTTName && !ttLower.includes('standard') && !ttLower.includes('resale'))
      ? rawTTName : '';

    if (isResale) {
      // RESALE GA: accumulate by normalized section+price, combine same-price listings
      offerIds.forEach((offerId) => {
        const offer = offers.find(o => o.offerId === offerId);
        if (!offer) return;
        if (offer.protected === true) return;
        if (offer.name === "Special Offers" || /4[\s-]*pack/i.test(offer.name) || /four[\s-]*pack/i.test(offer.name)) return;

        const sellableQuantities = offer.sellableQuantities || [1];
        const seatCount = Math.max(...sellableQuantities);
        const offerSection = offer.section || sectionName;
        const totalCost = calculateCost(offer, offer.faceValue || faceValue, seatCount);
        const costKey = Number(totalCost.toFixed(2));
        const key = `${normalizedSection}|${costKey}`;
        const allDescriptions = buildDescriptions(offer, resolvedAreas, facetDescriptionId) + addGATypeIndicator(offerSection);

        if (resaleGAAccumulator.has(key)) {
          const existing = resaleGAAccumulator.get(key);
          existing.count += seatCount;
        } else {
          resaleGAAccumulator.set(key, {
            count: seatCount, offer, sellableQuantities, allDescriptions, section: normalizedSection, totalCost: costKey,
            priceLevelLabel, ticketTypeName
          });
        }
      });
    } else {
      // PRIMARY GA: accumulate by normalized section+price, flush as single inventory lines after loop
      const offer = offerIds.length > 0 ? offers.find(o => o.offerId === offerIds[0]) : null;
      if (offer) {
        if (offer.protected === true) return;
        if (offer.name === "Special Offers" || /4[\s-]*pack/i.test(offer.name) || /four[\s-]*pack/i.test(offer.name)) return;
      }

      const sellableQuantities = offer?.sellableQuantities || ticketTypeInfo?.sellableQuantities || [1, 2, 3, 4, 5, 6, 7, 8];
      const allDescriptions = buildDescriptions(offer, resolvedAreas, facetDescriptionId) + addGATypeIndicator(sectionName);
      const totalCost = calculateCost(offer, faceValue, count);

      const costKey = Number(totalCost.toFixed(2));
      const key = `${normalizedSection}|${costKey}`;

      if (primaryGAAccumulator.has(key)) {
        const existing = primaryGAAccumulator.get(key);
        existing.count += count;
      } else {
        primaryGAAccumulator.set(key, {
          count, offer, sellableQuantities, allDescriptions, section: normalizedSection, totalCost: costKey,
          priceLevelLabel, ticketTypeName
        });
      }
    }
  });

  // Check if same GA type has multiple price tiers — if so, append priceLevelLabel to section
  const hasMultiplePrimaryPrices = new Map();
  primaryGAAccumulator.forEach(({ section }) => {
    hasMultiplePrimaryPrices.set(section, (hasMultiplePrimaryPrices.get(section) || 0) + 1);
  });
  const hasMultipleResalePrices = new Map();
  resaleGAAccumulator.forEach(({ section }) => {
    hasMultipleResalePrices.set(section, (hasMultipleResalePrices.get(section) || 0) + 1);
  });

  // Flush accumulated primary GA
  primaryGAAccumulator.forEach(({ count, offer, sellableQuantities, allDescriptions, section, totalCost, priceLevelLabel, ticketTypeName }) => {
    const finalSection = (hasMultiplePrimaryPrices.get(section) > 1 && priceLevelLabel)
      ? `${section} - ${priceLevelLabel}` : section;
    const finalNotes = ticketTypeName ? allDescriptions + `, ${ticketTypeName}` : allDescriptions;
    pushInventoryRow(finalSection, count, totalCost, offer, sellableQuantities, 'NEVERLEAVEONE', finalNotes);
  });

  // Flush accumulated resale GA
  resaleGAAccumulator.forEach(({ count, offer, sellableQuantities, allDescriptions, section, totalCost, priceLevelLabel, ticketTypeName }) => {
    const finalSection = (hasMultipleResalePrices.get(section) > 1 && priceLevelLabel)
      ? `${section} - ${priceLevelLabel}` : section;
    const finalNotes = ticketTypeName ? allDescriptions + `, ${ticketTypeName}` : allDescriptions;
    pushInventoryRow(finalSection, count, totalCost, offer, sellableQuantities, 'DEFAULT', finalNotes);
  });

  return returnData;
};

export const AttachRowSection = (
  data,
  mapData,
  offers,
  event,
  descriptions
) => {
  let allAvailableSeats = GetMapSeats(mapData);
  let mapPlacesIndex = allAvailableSeats.map((x) => x.seatId);
  // fs.writeFileSync("debug/allAvailableSeats.json", JSON.stringify(allAvailableSeats));
  let returnData = [];
  //get all seats number by seat id
  let customData = data
    .map((x) => {
      if (!x.places || x.places.length === 0) {
        return undefined;
      }

      // Verify all places belong to the same section
      const sectionMap = {};
      const allPlaces = x.places
        .map((placeId) => {
          const index = mapPlacesIndex.indexOf(placeId);
          if (index === -1) {
            return null;
          }
          
          const seatInfo = allAvailableSeats[index];
          if (!seatInfo) return null;
          
          // Track sections for verification
          sectionMap[seatInfo.section] = true;
          
          return { ...seatInfo, offerId: x.offerId };
        })
        .filter(Boolean);

      // Skip if no valid seats found
      if (allPlaces.length === 0) {
        return undefined;
      }

      // Verify all seats belong to same section
      const sections = Object.keys(sectionMap);
      // if (sections.length > 1) {
      //   console.warn('Mixed sections in seat group:', sections.join(', '));
      // }

      return {
        section: allPlaces[0].section,
        row: "",
        seats: allPlaces,
        eventId: event?.eventMappingId,
        offerId: x.offerId,
        accessibility: x?.accessibility,
        descriptionId: x?.descriptionId,
        attributes: x?.attributes,
      };
    })
    .filter(Boolean);

  //it will check if pair has same row as some events are giving pair of different row
  let groupedSeats = [];
  customData.forEach((seatGroup) => {
    const rows = [...new Set(seatGroup.seats.map((seat) => seat.row))];
    rows.forEach((row) => {
      const seatsInRow = seatGroup.seats.filter((seat) => seat.row === row);
      groupedSeats.push({
        section: seatGroup.section,
        seats: seatsInRow,
        eventId: seatGroup.eventId,
        offerId: seatGroup.offerId,
        accessibility: seatGroup.accessibility,
        descriptionId: seatGroup.descriptionId,
        attributes: seatGroup.attributes,
      });
    });
  });

  //add row and get seats in order
  groupedSeats
    .map((x) => {
      if (x?.seats.length > 0) {
        return {
          ...x,
          row: x?.seats[0]?.row,
          seats: x?.seats
            .map((y) => parseInt(y.seat))
            .sort((a, b) => {
              return a - b;
            }),
        };
      } else {
        return undefined;
      }
    })
    .filter((x) => x != undefined)

    //break seats if it is not consicutive ex [1,2,3,6,7] => [1,2,3],[6,7]
    .map((x) => {
      let breakOBJ = breakArray(x.seats);

      if (breakOBJ.length > 1) {
        breakOBJ.map((y) => {
          returnData.push({
            ...x,
            seats: y,
          });
        });
      } else {
        returnData.push(x);
      }
    });

  //it will make consicutive seats ex [2],[4],[3] => [2,3,4]
  returnData = CreateConsicutiveSeats(returnData);
  // fs.writeFileSync("debug/consicutive.json", JSON.stringify(returnData));

  //attach offer

  const finalData = returnData
      .map((x) => {
        let offerGet = offers.find((e) => e.offerId == x.offerId);

        // Check accessibility exclusion filters first
        if (GLOBAL_FILTERS.excludeAccessibility) {
          // Check for any accessibility indicators in various fields
          const hasAccessibilityIndicators = (
            // Check section name for wheelchair/accessibility indicators
            (x.section && (
              x.section.toUpperCase().includes('WC') ||
              x.section.toUpperCase().includes('WHEELCHAIR') ||
              x.section.toUpperCase().includes('ACCESSIBLE') ||
              x.section.toUpperCase().includes('ADA') ||
              x.section.toUpperCase().includes('HANDICAP')
            )) ||
            // Check accessibility field
            (x.accessibility && x.accessibility.length > 0) ||
            // Check attributes for accessibility terms
            (x.attributes && x.attributes.some(attr => 
              attr.toLowerCase().includes('wheelchair') ||
              attr.toLowerCase().includes('accessible') ||
              attr.toLowerCase().includes('ada') ||
              attr.toLowerCase().includes('handicap') ||
              attr.toLowerCase().includes('sight') ||
              attr.toLowerCase().includes('hearing')
            )) ||
            // Check offer name for accessibility terms
            (offerGet && offerGet.name && (
              offerGet.name?.toLowerCase().includes('wheelchair') ||
              offerGet.name?.toLowerCase().includes('accessible') ||
              offerGet.name?.toLowerCase().includes('ada') ||
              offerGet.name?.toLowerCase().includes('handicap')
            ))
          );
          
          if (hasAccessibilityIndicators) {
            // console.log(`Filtering out accessibility seat. Section: ${x.section}, Accessibility: ${x.accessibility}`);
            return undefined;
          }
        }

        // Legacy wheelchair exclusion filter (kept for backward compatibility)
        if (GLOBAL_FILTERS.excludeWheelchair && x.section && x.section.toUpperCase().includes('WC')) {
          // console.log(`Filtering out wheelchair seat. Section: ${x.section}`);
          return undefined;
        }

        // New Global Filtering Logic: Item must match at least one active global filter category.
        let keepItemBasedOnGlobalFilters = false;
        const inventoryFilterActive = GLOBAL_FILTERS.inventoryType.length > 0;
        const descriptionFilterActive = GLOBAL_FILTERS.description.length > 0;
        const accessibilityFilterActive = GLOBAL_FILTERS.accessibility.length > 0;

        const anyGlobalFilterActive = inventoryFilterActive || descriptionFilterActive || accessibilityFilterActive;

        if (!anyGlobalFilterActive) {
            keepItemBasedOnGlobalFilters = true; // No global filters are active, so item passes this stage
        } else {
            // Check Inventory Type Filter
            if (inventoryFilterActive) {
                if (offerGet && GLOBAL_FILTERS.inventoryType.some(filterType => 
                    offerGet.inventoryType?.toLowerCase().includes(filterType.toLowerCase())
                )) {
                    keepItemBasedOnGlobalFilters = true;
                }
            }

            // Check Description Filter (only if not already marked to keep)
            if (!keepItemBasedOnGlobalFilters && descriptionFilterActive) {
                let descriptionMatched = false;
                const offerNameLower = offerGet?.name?.toLowerCase() || "";
                const offerDescriptionLower = offerGet?.description?.toLowerCase() || "";
                
                if (GLOBAL_FILTERS.description.some(filterTerm => 
                    offerNameLower.includes(filterTerm.toLowerCase()) || 
                    offerDescriptionLower.includes(filterTerm.toLowerCase())
                )) {
                    descriptionMatched = true;
                }

                if (!descriptionMatched && descriptions) {
                    const relevantDescriptionDoc = descriptions.find(d => d.descriptionId === x.descriptionId);
                    if (relevantDescriptionDoc && relevantDescriptionDoc.descriptions) {
                        const descriptionsTextLower = relevantDescriptionDoc.descriptions.join(' ').toLowerCase();
                        if (GLOBAL_FILTERS.description.some(filterTerm => descriptionsTextLower.includes(filterTerm.toLowerCase()))) {
                            descriptionMatched = true;
                        }
                    }
                }
                
                if (!descriptionMatched && x.attributes && x.attributes.length > 0){
                    const attributesTextLower = x.attributes.join(' ').toLowerCase();
                    if (GLOBAL_FILTERS.description.some(filterTerm => attributesTextLower.includes(filterTerm.toLowerCase()))) {
                        descriptionMatched = true;
                    }
                }

                if (descriptionMatched) {
                    keepItemBasedOnGlobalFilters = true;
                }
            }

            // Check Accessibility Filter (only if not already marked to keep)
            if (!keepItemBasedOnGlobalFilters && accessibilityFilterActive) {
                if (x.accessibility) {
                    const accessibilityLower = x.accessibility.toLowerCase();
                    if (GLOBAL_FILTERS.accessibility.some(filterTerm => accessibilityLower.includes(filterTerm.toLowerCase()))) {
                        keepItemBasedOnGlobalFilters = true;
                    }
                }
            }
        }

        if (!keepItemBasedOnGlobalFilters) {
            // console.log(`Filtering out by global filters combination. Item: ${x.section}-${x.row}-${x.seats}, Offer: ${offerGet?.name}`);
            return undefined;
        }

        // Original offer filtering logic
        if (offerGet) {
          if (offerGet.name == "Special Offers") {
            return undefined;
          } else if (offerGet.name == "Summer's Live 4 Pack") {
            return undefined;
          } else if (offerGet.name == "Me + 3 4-Pack Offer") {
            return undefined;
          } else if (/4[\s-]*pack/i.test(offerGet.name)) {
            return undefined;
          } if (/four[\s-]*pack/i.test(offerGet.name)) {
            return undefined;
          } else if (offerGet?.protected == true) {
            return undefined;
          } else {
            return CreateInventoryAndLine(x, offerGet, event, descriptions);
          }
        } else {
          return undefined;
        }
        
      })
      .filter((x) => x != undefined)
      .filter((obj, index, self) => {
        // Convert dbId value to string to compare
        var dbId = obj.dbId.toString();

        // Check if the current dbId is the first occurrence in the array
        return index === self.findIndex((o) => o.dbId.toString() === dbId);
      })
      // .filter((x) => x.inventory.quantity > 1) // Commented out to prevent losing single seats

      //remove duplicate
      .filter((obj, index, self) => {
        // Check if any other object has the same row and section
        const hasDuplicate = self.some((otherObj, otherIndex) => {
          return (
            index !== otherIndex && // Exclude the current object from comparison
            obj.row === otherObj.row &&
            obj.section === otherObj.section &&
            obj.seats.some((seat) => otherObj.seats.includes(seat))
          );
        });

        return !hasDuplicate || index === 0; // Keep the first object or objects without duplicates
      });

  // fs.writeFileSync(`debug/seatBatch_${event.eventMappingId}.json`, JSON.stringify(finalData, null, 2));
  
  // // Debug: Final processed data after all filters
  // fs.writeFileSync(`debug/finalProcessed_${event.eventMappingId}.json`, JSON.stringify(finalData, null, 2));
  // console.log(`Final processed data written to debug/finalProcessed_${event.eventMappingId}.json - Total items: ${finalData.length}`);

  return finalData;
};
