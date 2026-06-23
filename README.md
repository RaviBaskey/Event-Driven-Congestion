# 🚦 FlowCast — Intelligent Event-Driven Traffic Impact Forecaster

> **FlowCast** is an intelligent, event-driven traffic management and routing platform that connects public road users with Traffic Commanders through a real-time, synchronized dashboard.
>
> For the **Public**, FlowCast acts as a smart navigator. Users can report live incidents directly on the map and calculate intelligent alternative routes that automatically bypass high-severity road closures and active events.
>
> For **Traffic Commanders**, it serves as a powerful incident response hub. When a pending incident is physically verified, FlowCast utilizes a Machine Learning model trained on historical data to predict the event's impact severity, estimate its clearance time (ETR), and automatically recommend the optimal resource allocation (manpower, barricading, and diversion plans) to resolve congestion efficiently.

---

## ✨ Features

- 🗺️ **Interactive TomTom Maps Integration** — Features dynamic TomTom map rendering with custom markers, popups, and advanced GeoJSON routing layers.
- 🚦 **Dual Role System** — Dedicated Commander (Admin) and Navigator (Public) views with real-time state synchronization.
- 🤖 **ML-Based Severity Prediction** — Random Forest model trained on historical event data to predict impact severity and predict clearance/ETR times.
- 📊 **Resource Allocation Engine** — Intelligent recommendations (Manpower, Barricading, Diversion) based on predicted incident severity.
- 🔀 **Smart Routing with Avoidance** — Calculates alternative routes using the TomTom Routing API, automatically avoiding areas with high-severity active incidents.
- ⚡ **Real-Time Polling** — Frontend automatically updates live events and approval queues without full-page reloads.
- 🎨 **Modern Premium UI** — Responsive, animated interface with dark/light themes, modal pop-ups, interactive route selection cards, and live countdown tickers.

---

## 🛠 Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Backend    | Python 3.9+, FastAPI, Uvicorn     |
| ML / Data  | scikit-learn, pandas, numpy, joblib |
| Frontend   | HTML5, CSS3, Vanilla JavaScript   |
| Map        | TomTom Maps Web SDK, TomTom Routing API |

---

## 🚀 Local Setup & Running

### Step 1 — Clone & Environment
```bash
git clone https://github.com/RaviBaskey/Event-Driven-Congestion.git FlowCast
cd FlowCast

# Create and activate a virtual environment
python -m venv venv
# On Windows: .\venv\Scripts\activate
# On Mac/Linux: source venv/bin/activate
```

### Step 2 — Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 3 — Train the Model (Optional)
If `impact_model.pkl` and `encoders.pkl` do not exist, run the training script:
```bash
python train_model.py
```

### Step 4 — Environment Variables
Create a `.env` file in the root directory and add your TomTom API key:
```env
TOMTOM_API_KEY=your_api_key_here
```

### Step 5 — Start the Server
```bash
python app.py
```
Open your browser and navigate to `http://localhost:8000`.
