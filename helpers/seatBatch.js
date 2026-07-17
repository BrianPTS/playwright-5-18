import moment from "moment";
import * as fs from "fs";
// Function to generate unique 10-digit inventory ID

// Global Filters
const GLOBAL_FILTERS = {
  inventoryType: [
    "Primary",
    "Official Platinum",
    "Aisle Seating",
    "Standard",
    "Standard Ticket",
    "resale",
  ], // e.g., ['primary', 'resale'] - empty means no filter, strings to check for (case-insensitive)

  inventoryStatus: ["Available"], // e.g., ['available', 'sold'] - empty means no filter, strings to check for (case-insensitive)

  description: [
    "Standard Ticket",
    "GA Lawn",
    "General Admission Standing",
    "Standard Admission",
    "Reserved",
    "Reserved Ticket",
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
            } else if (SECTION.name && SECTION.id) {
              // Fallback if placesNoKeys is not present but section has name and id
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
      if (
        group.section === item.section &&
        group.row === item.row &&
        group.offerId === item.offerId
      ) {
        // Check if seats are consecutive (either direction)
        const groupLastSeat = Math.max(...group.seats);
        const groupFirstSeat = Math.min(...group.seats);
        const itemFirstSeat = Math.min(...item.seats);
        const itemLastSeat = Math.max(...item.seats);

        // Check if they can be merged (consecutive) - fixed logic
        if (
          groupLastSeat + 1 === itemFirstSeat ||
          itemLastSeat + 1 === groupFirstSeat
        ) {
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
        areas: item?.areas || [],
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

        if (
          group1.section === group2.section &&
          group1.row === group2.row &&
          group1.offerId === group2.offerId
        ) {
          const group1LastSeat = Math.max(...group1.seats);
          const group1FirstSeat = Math.min(...group1.seats);
          const group2FirstSeat = Math.min(...group2.seats);
          const group2LastSeat = Math.max(...group2.seats);

          // Check if they can be merged (consecutive)
          if (
            group1LastSeat + 1 === group2FirstSeat ||
            group2LastSeat + 1 === group1FirstSeat
          ) {
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
        (_, i) => (i % 2 == 0 ? i + 2 : undefined),
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
        (x) => x != 1,
      );
      return numbers.join(",");
    } else return "1";
  }
}

export function CreateInventoryAndLine(
  data,
  offer,
  event,
  descriptions,
  resaleClassification = new Map(),
  debugSplitLog = null,
  limitedViewAreaIds = new Set(),
) {
  let _descriptions = descriptions.find(
    (x) => x.descriptionId == data?.descriptionId,
  );
  let allDescriptions = "";
  const tags = new Set(); // track what we already appended to avoid duplicates

  // Case-insensitive check on attributes array
  const attrsLower = (data.attributes || []).map((a) => a.toLowerCase());
  if (attrsLower.some((a) => a.includes("obstructed"))) {
    allDescriptions += ", Obstructed View";
    tags.add("obstructed");
  }

  if (
    data?.accessibility.includes("sight") ||
    data?.accessibility.includes("hearing")
  ) {
    allDescriptions += ", deaf/hard, blind/low";
    tags.add("accessibility");
  }

  // Run the same keyword scan against every text source TM gives us so
  // phrases with words between "Limited" and "View" (e.g. "Limited Side
  // View") still produce both Limited and Side View tags. Sources scanned:
  //   1. offer.name        (TM's "title" on the seat popup)
  //   2. offer.description (offer's own description field)
  //   3. each line in the _embedded.description doc tied to descriptionId
  const offerNameLower = offer?.name?.toLowerCase() || "";
  const offerDescLower = offer?.description?.toLowerCase() || "";
  const textSources = [offerNameLower, offerDescLower];
  if (_descriptions?.descriptions) {
    for (const d of _descriptions.descriptions) {
      textSources.push((d || "").toLowerCase());
    }
  }

  // Handle the combined "Limited/Obstructed" phrase first so we emit the
  // canonical "Limited/Obstructed View" label instead of two separate tags.
  if (
    textSources.some((t) => t.includes("limited/obstructed")) &&
    !tags.has("obstructed")
  ) {
    allDescriptions += ", Limited/Obstructed View";
    tags.add("obstructed");
    tags.add("limited");
  }

  for (const text of textSources) {
    if (!text) continue;
    if (text.includes("obstructed") && !tags.has("obstructed")) {
      allDescriptions += ", Obstructed View";
      tags.add("obstructed");
    }
    // "limited" alone covers "Limited View", "Limited Side View", "Limited
    // Rear View", etc.
    if (text.includes("limited") && !tags.has("limited")) {
      allDescriptions += ", Limited View";
      tags.add("limited");
    }
    if (text.includes("side view") && !tags.has("side")) {
      allDescriptions += ", Side View";
      tags.add("side");
    }
    if (text.includes("behind") && !tags.has("behind")) {
      allDescriptions += ", Behind The Stage";
      tags.add("behind");
    }
    if (text.includes("rear") && !tags.has("rear")) {
      allDescriptions += ", Rear View Seating";
      tags.add("rear");
    }
    if (text.includes("partial") && !tags.has("partial")) {
      allDescriptions += ", Partial View";
      tags.add("partial");
    }
    if (
      (text.includes("deaf") || text.includes("blind")) &&
      !tags.has("accessibility")
    ) {
      allDescriptions += ", deaf/hard, blind/low";
      tags.add("accessibility");
    }
  }

  // Area-based limited/obstructed view. TM also encodes this in the facet's
  // `areas` array (IDs resolved against _embedded.area). Resale facets often
  // carry a plain description code with no LBW suffix and no "limited" text,
  // so the keyword scan above misses them — the area ID is the only signal.
  if ((data.areas || []).some((id) => limitedViewAreaIds.has(String(id)))) {
    if (!tags.has("limited")) {
      allDescriptions += ", Limited View";
      tags.add("limited");
    }
    if (!tags.has("obstructed")) {
      tags.add("obstructed");
    }
  }

  // Belt-and-suspenders: TM description codes ending in "LBW" denote
  // LIMITED VIEW (e.g. IE5DELBW). Covers events where the area map is absent.
  if (
    typeof data?.descriptionId === "string" &&
    data.descriptionId.toUpperCase().endsWith("LBW") &&
    !tags.has("limited")
  ) {
    allDescriptions += ", Limited View";
    tags.add("limited");
  }

  // Classify charges using TM's fee_type field when available, falling back to reason-based logic.
  // TM charge objects can include: { reason, type, amount, fee_type }
  //   fee_type: "PER ORDER" (split across seats) or "PER TICKET" (applied to each seat)
  //   Known reasons: order_processing, service, facility, delivery, service_tax, face_value_tax, service_tax_2
  const charges = offer?.charges || [];

  // Per-order fees: use fee_type if present, otherwise fall back to known per-order reasons
  let perOrderTotal = parseFloat(
    charges
      .filter((x) =>
        x?.fee_type
          ? x.fee_type === "PER ORDER"
          : x?.reason === "order_processing" || x?.reason === "delivery",
      )
      .reduce((total, item) => total + item.amount, 0),
  );
  let perOrderPerSeat = perOrderTotal / data?.seats.length;

  // Per-ticket fees: everything that is NOT per-order
  let perTicketTotal = parseFloat(
    charges
      .filter((x) =>
        x?.fee_type
          ? x.fee_type !== "PER ORDER"
          : x?.reason !== "order_processing" && x?.reason !== "delivery",
      )
      .reduce((total, item) => total + item.amount, 0),
  );

  // Face Value (true TM face value before any fees)
  let faceValue = offer?.faceValue;
  let totalFees = perOrderPerSeat + perTicketTotal;
  let totalCost = faceValue + totalFees;

  const derivedSplit = getSplitType(data?.seats, offer);

  // Standard listings: only override the NEVERLEAVEONE heuristic when TM forces a
  // minimum purchase of 4 or more (e.g. [4,5,6], [4,6], [5]). For min 1-3 the heuristic
  // handles splits better and avoids stranding seats.
  // Resale listings are always bound by whatever TM publishes for the seller.
  const tmSQ = offer?.sellableQuantities;
  const isResale = offer?.inventoryType?.toLowerCase() === "resale";
  let finalCustomSplit = derivedSplit;
  let splitSource = "derived";
  if (Array.isArray(tmSQ) && tmSQ.length > 0) {
    const minSQ = Math.min(...tmSQ);
    if (isResale || minSQ >= 4) {
      const clipped = tmSQ.filter((q) => q <= data?.seats.length);
      if (clipped.length > 0) {
        finalCustomSplit = clipped.join(",");
        splitSource = isResale ? "tm_resale" : "tm_forced";
      }
    }
  }

  if (debugSplitLog) {
    debugSplitLog.push({
      section: data?.section,
      row: data?.row,
      seats: data?.seats,
      quantity: data?.seats.length,
      offerId: data?.offerId,
      offerName: offer?.name || null,
      inventoryType: offer?.inventoryType || null,
      tmSellableQuantities: Array.isArray(tmSQ) ? tmSQ : null,
      tmTicketTypeUnsoldQualifier: offer?.ticketTypeUnsoldQualifier || null,
      derivedSplit,
      finalCustomSplit,
      splitSource,
      faceValue,
      totalCost,
      resaleType: resaleClassification.get(data?.offerId) || "unknown",
    });
  }

  const resolvedResaleType = isResale
    ? resaleClassification.get(data?.offerId) || "unknown"
    : null;
  const classifierTag =
    resolvedResaleType === "verified_resale"
      ? "fan inventory"
      : resolvedResaleType === "3rd_party_resale"
        ? "broker"
        : "";

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
      notes: "",
      tags: isResale
        ? classifierTag ? `resale ${classifierTag}` : "resale"
        : "standard",
      offerId: data?.offerId,
      splitType: isResale ? "DEFAULT" : "NEVERLEAVEONE",
      resaleType: resolvedResaleType,
      publicNotes: "xfer" + allDescriptions,
      listPrice: totalCost,
      originalFaceValue: faceValue,
      totalFees: totalFees,
      customSplit: finalCustomSplit,
      tickets: data?.seats.map((y) => {
        return {
          id: 0,
          seatNumber: y,
          notes: "string",
          cost: totalCost,
          faceValue: faceValue,
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

export const AttachRowSection = (
  data,
  mapData,
  offers,
  event,
  descriptions,
  resaleClassification = new Map(),
  limitedViewAreaIds = new Set(),
) => {
  // Debug: collect per-resale-listing split info when DEBUG_SPLIT=1.
  // null when disabled, so CreateInventoryAndLine skips the push entirely.
  const debugSplitLog = process.env.DEBUG_SPLIT === "1" ? [] : null;

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
        areas: x?.areas || [],
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
        areas: seatGroup.areas || [],
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
        const hasAccessibilityIndicators =
          // Check section name for wheelchair/accessibility indicators
          (x.section &&
            (x.section.toUpperCase().includes("WC") ||
              x.section.toUpperCase().includes("WHEELCHAIR") ||
              x.section.toUpperCase().includes("ACCESSIBLE") ||
              x.section.toUpperCase().includes("ADA") ||
              x.section.toUpperCase().includes("HANDICAP") ||
              x.section.toUpperCase().includes("COMPANION"))) ||
          // Check accessibility field
          (x.accessibility && x.accessibility.length > 0) ||
          // Check attributes for accessibility terms
          (x.attributes &&
            x.attributes.some(
              (attr) =>
                attr.toLowerCase().includes("wheelchair") ||
                attr.toLowerCase().includes("accessible") ||
                attr.toLowerCase().includes("ada") ||
                attr.toLowerCase().includes("handicap") ||
                attr.toLowerCase().includes("sight") ||
                attr.toLowerCase().includes("hearing") ||
                attr.toLowerCase().includes("companion") ||
                attr.toLowerCase().includes("mobility") ||
                attr.toLowerCase().includes("transfer"),
            )) ||
          // Check offer name for accessibility terms
          (offerGet &&
            offerGet.name &&
            (offerGet.name?.toLowerCase().includes("wheelchair") ||
              offerGet.name?.toLowerCase().includes("accessible") ||
              offerGet.name?.toLowerCase().includes("ada") ||
              offerGet.name?.toLowerCase().includes("handicap") ||
              offerGet.name?.toLowerCase().includes("companion") ||
              offerGet.name?.toLowerCase().includes("mobility") ||
              offerGet.name?.toLowerCase().includes("sight") ||
              offerGet.name?.toLowerCase().includes("hearing"))) ||
          // Check description text via descriptionId — TM often surfaces
          // "Wheelchair Companion" / "Companion Seat" / "Limited Mobility"
          // only here, not in attributes.
          (descriptions &&
            x?.descriptionId != null &&
            (() => {
              const descDoc = descriptions.find?.(
                (d) => d.descriptionId == x.descriptionId,
              );
              if (!descDoc?.descriptions?.length) return false;
              const descText = descDoc.descriptions.join(" ").toLowerCase();
              return (
                descText.includes("wheelchair") ||
                descText.includes("accessible") ||
                descText.includes("ada") ||
                descText.includes("handicap") ||
                descText.includes("companion") ||
                descText.includes("mobility") ||
                descText.includes("sight") ||
                descText.includes("hearing") ||
                descText.includes("transfer")
              );
            })());

        if (hasAccessibilityIndicators) {
          // console.log(`Filtering out accessibility seat. Section: ${x.section}, Accessibility: ${x.accessibility}`);
          return undefined;
        }
      }

      // Legacy wheelchair exclusion filter (kept for backward compatibility)
      if (
        GLOBAL_FILTERS.excludeWheelchair &&
        x.section &&
        x.section.toUpperCase().includes("WC")
      ) {
        // console.log(`Filtering out wheelchair seat. Section: ${x.section}`);
        return undefined;
      }

      // New Global Filtering Logic: Item must match at least one active global filter category.
      let keepItemBasedOnGlobalFilters = false;
      const inventoryFilterActive = GLOBAL_FILTERS.inventoryType.length > 0;
      const descriptionFilterActive = GLOBAL_FILTERS.description.length > 0;
      const accessibilityFilterActive = GLOBAL_FILTERS.accessibility.length > 0;

      const anyGlobalFilterActive =
        inventoryFilterActive ||
        descriptionFilterActive ||
        accessibilityFilterActive;

      if (!anyGlobalFilterActive) {
        keepItemBasedOnGlobalFilters = true; // No global filters are active, so item passes this stage
      } else {
        // Check Inventory Type Filter
        if (inventoryFilterActive) {
          if (
            offerGet &&
            GLOBAL_FILTERS.inventoryType.some((filterType) =>
              offerGet.inventoryType
                ?.toLowerCase()
                .includes(filterType.toLowerCase()),
            )
          ) {
            keepItemBasedOnGlobalFilters = true;
          }
        }

        // Check Description Filter (only if not already marked to keep)
        if (!keepItemBasedOnGlobalFilters && descriptionFilterActive) {
          let descriptionMatched = false;
          const offerNameLower = offerGet?.name?.toLowerCase() || "";
          const offerDescriptionLower =
            offerGet?.description?.toLowerCase() || "";

          if (
            GLOBAL_FILTERS.description.some(
              (filterTerm) =>
                offerNameLower.includes(filterTerm.toLowerCase()) ||
                offerDescriptionLower.includes(filterTerm.toLowerCase()),
            )
          ) {
            descriptionMatched = true;
          }

          if (!descriptionMatched && descriptions) {
            const relevantDescriptionDoc = descriptions.find(
              (d) => d.descriptionId === x.descriptionId,
            );
            if (relevantDescriptionDoc && relevantDescriptionDoc.descriptions) {
              const descriptionsTextLower = relevantDescriptionDoc.descriptions
                .join(" ")
                .toLowerCase();
              if (
                GLOBAL_FILTERS.description.some((filterTerm) =>
                  descriptionsTextLower.includes(filterTerm.toLowerCase()),
                )
              ) {
                descriptionMatched = true;
              }
            }
          }

          if (!descriptionMatched && x.attributes && x.attributes.length > 0) {
            const attributesTextLower = x.attributes.join(" ").toLowerCase();
            if (
              GLOBAL_FILTERS.description.some((filterTerm) =>
                attributesTextLower.includes(filterTerm.toLowerCase()),
              )
            ) {
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
            if (
              GLOBAL_FILTERS.accessibility.some((filterTerm) =>
                accessibilityLower.includes(filterTerm.toLowerCase()),
              )
            ) {
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
        // Exclude "Summer of Live Promotion" wherever it shows up: offer name,
        // offer description, TM description doc, or seat-level attributes
        // (case-insensitive substring match).
        const summerLiveTerm = "summer of live promotion";
        const offerNameLowerForExclude = offerGet?.name?.toLowerCase() || "";
        const offerDescLowerForExclude =
          offerGet?.description?.toLowerCase() || "";
        const attrsTextLowerForExclude = (x.attributes || [])
          .join(" ")
          .toLowerCase();
        const descDocForExclude = descriptions?.find?.(
          (d) => d.descriptionId == x.descriptionId,
        );
        const descTextLowerForExclude =
          descDocForExclude?.descriptions?.join(" ").toLowerCase() || "";
        if (
          offerNameLowerForExclude.includes(summerLiveTerm) ||
          offerDescLowerForExclude.includes(summerLiveTerm) ||
          attrsTextLowerForExclude.includes(summerLiveTerm) ||
          descTextLowerForExclude.includes(summerLiveTerm)
        ) {
          return undefined;
        }

        // Exclude held inventory: any offer whose ticketTypeUnsoldQualifier
        // ends in "HOLD" (e.g. VIP5HOLD, 2PACKHOLD) is held back from
        // general sale and shouldn't be listed.
        if (
          typeof offerGet?.ticketTypeUnsoldQualifier === "string" &&
          /HOLD$/i.test(offerGet.ticketTypeUnsoldQualifier)
        ) {
          return undefined;
        }

        // Exclude package offers: if the offer description mentions
        // "package", it's a bundled VIP/experience product, not a plain
        // ticket, and shouldn't be listed.
        if (
          typeof offerGet?.description === "string" &&
          /package/i.test(offerGet.description)
        ) {
          return undefined;
        }

        if (offerGet.name == "Special Offers") {
          return undefined;
        } else if (offerGet.name == "Summer's Live 4 Pack") {
          return undefined;
        } else if (offerGet.name == "Me + 3 4-Pack Offer") {
          return undefined;
        } else if (/4[\s-]*pack/i.test(offerGet.name)) {
          return undefined;
        }
        if (/four[\s-]*pack/i.test(offerGet.name)) {
          return undefined;
        } else if (offerGet?.protected == true) {
          return undefined;
        } else {
          return CreateInventoryAndLine(
            x,
            offerGet,
            event,
            descriptions,
            resaleClassification,
            debugSplitLog,
            limitedViewAreaIds,
          );
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

  // fs.writeFileSync(`debug/seatBatch_${event.eventId}.json`, JSON.stringify(finalData, null, 2));

  // // Debug: Final processed data after all filters
  // fs.writeFileSync(`debug/finalProcessed_${event.eventId}.json`, JSON.stringify(finalData, null, 2));
  // console.log(`Final processed data written to debug/finalProcessed_${event.eventId}.json - Total items: ${finalData.length}`);

  // ── Debug: split summary for all listings (DEBUG_SPLIT=1) ────────────
  if (debugSplitLog && debugSplitLog.length > 0) {
    const sqPatternCounts = {};
    const sourceCounts = { tm_resale: 0, tm_forced: 0, derived: 0 };
    const byInventoryType = {};
    let withSQ = 0;
    for (const entry of debugSplitLog) {
      const sqKey = entry.tmSellableQuantities
        ? `[${entry.tmSellableQuantities.join(",")}]`
        : "(none)";
      sqPatternCounts[sqKey] = (sqPatternCounts[sqKey] || 0) + 1;
      sourceCounts[entry.splitSource] =
        (sourceCounts[entry.splitSource] || 0) + 1;
      const it = entry.inventoryType || "unknown";
      byInventoryType[it] = (byInventoryType[it] || 0) + 1;
      if (entry.tmSellableQuantities) withSQ++;
    }

    console.log(
      `[SplitDebug ${event.eventId}] ${debugSplitLog.length} listings | ` +
        `TM (resale): ${sourceCounts.tm_resale} | ` +
        `TM (forced primary): ${sourceCounts.tm_forced} | ` +
        `heuristic: ${sourceCounts.derived} | ` +
        `sellableQuantities present on offer: ${withSQ}`,
    );
    console.log(
      `[SplitDebug ${event.eventId}] by inventoryType: ${JSON.stringify(byInventoryType)}`,
    );
    console.log(
      `[SplitDebug ${event.eventId}] sellableQuantities distribution: ${JSON.stringify(sqPatternCounts)}`,
    );

    for (const entry of debugSplitLog) {
      const tmRaw = entry.tmSellableQuantities
        ? `[${entry.tmSellableQuantities.join(",")}]`
        : "(none)";
      console.log(
        `[SplitDebug ${event.eventId}] [${entry.inventoryType || "?"}] ${entry.section} Row ${entry.row} Seats [${entry.seats.join(",")}] ` +
          `qty=${entry.quantity} | TM: ${tmRaw} | ` +
          `heuristic: ${entry.derivedSplit} | final: ${entry.finalCustomSplit} (${entry.splitSource}) | ` +
          `$${entry.totalCost?.toFixed?.(2) ?? entry.totalCost}`,
      );
    }

    try {
      const debugDir = "./debug";
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      fs.writeFileSync(
        `${debugDir}/splits_${event.eventId}.json`,
        JSON.stringify(
          {
            eventId: event.eventId,
            capturedAt: new Date().toISOString(),
            totalListings: debugSplitLog.length,
            listingsByInventoryType: byInventoryType,
            listingsWithSellableQuantities: withSQ,
            splitSourceCounts: sourceCounts,
            sellableQuantitiesDistribution: sqPatternCounts,
            listings: debugSplitLog,
          },
          null,
          2,
        ),
      );
      console.log(
        `[SplitDebug ${event.eventId}] Wrote ${debugDir}/splits_${event.eventId}.json`,
      );
    } catch (debugErr) {
      console.warn(
        `[SplitDebug] Failed to write debug file: ${debugErr.message}`,
      );
    }
  }
  // ── End split debug ──────────────────────────────────────────────────

  return finalData;
};
