# ZIG: Multi-Stop Route Optimizer & Voice Navigation

ZIG is an open-source, production-ready, zero-cost multi-stop route optimization and navigation web app built for seamless travel planning, errand running, and delivery routing. 

---

## 1. Architectural Overview

ZIG is engineered as a lightweight, client-side geospatial web application with zero external API key requirements, leveraging robust public geospatial APIs and open-source mapping libraries.

* **Frontend & Map Rendering Engine:** 
  * Built using **Leaflet.js** for performant interactive map vector rendering and marker clustering.
  * Multi-layer tile support: OpenStreetMap (Streets/Dark modes) and Esri World Imagery (Satellite).
* **Geocoding & Rooftop Pinpointing Pipeline:**
  * Multi-provider geocoding architecture combining **ArcGIS World Geocoding Service** (for rooftop-accurate house number resolution and typo handling), **Komoot Photon**, and **Nominatim / OpenStreetMap** for comprehensive metro-area coverage.
* **TSP Routing & Matrix Engine:**
  * Powered by **OSRM (Project OSRM)** routing, table, and route geometry services.
  * Features a custom client-side Traveling Salesperson Problem (TSP) matrix solver supporting exhaustive permutations (up to 9 stops) and nearest-neighbor + 2-opt heuristics (10+ stops) across multiple goals (*Fastest time*, *Shortest distance*, *Fuel-efficient*).
* **Speech & Voice Command Architecture:**
  * Utilizes the browser-native **Web Speech API** (`SpeechRecognition` / `SpeechSynthesis`) for hands-free command execution and real-time turn-by-turn voice guidance.
* **Deployment Infrastructure:**
  * Hosted and distributed globally via **Cloudflare Pages / Workers**.

---

## 2. Core Features & User Experience

* **Automated TSP Route Optimization:** Instantly re-orders random stops to eliminate backtracking, calculating exact time and fuel savings compared to the original route order.
* **Precise Fuel & Cost Estimation:** Dynamically computes fuel consumption and dollar costs based on user-configured vehicle MPG, L/100km, and local fuel prices.
* **Multi-Mode Routing & Vehicle Avatars:** Fully supports Driving, Motorcycles, Cycling (with calorie burn estimates), and Walking, complete with custom vector avatars (Sedan, SUV, Truck, Bike, Pedestrian).
* **60-FPS Demo Simulator:** Includes an interactive simulation mode with adjustable speed multipliers (**1x to 40x**), pause/resume controls, and live HUD turn banners.
* **Nearby POI Discovery:** Local radius search for Gas, EV Charging, Coffee, Food, Groceries, Parking, and Hospitals with instant one-tap detour addition.
* **Incident Reporting & Hands-Free Voice Controls:** Report speed traps, hazards, or accidents hands-free, and control navigation via natural voice commands.
* **Direct Google Maps Export:** Preserves exact street addresses and waypoints when exporting optimized routes directly to Google Maps.
