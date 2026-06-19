document.addEventListener("DOMContentLoaded", () => {
    
    // Initialize Map centered on Bengaluru
    const map = L.map('map').setView([12.9716, 77.5946], 11);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    let currentMarker = null;
    let selectedLat = null;
    let selectedLng = null;

    // Handle Map Clicks
    map.on('click', function(e) {
        if (currentMarker) {
            map.removeLayer(currentMarker);
        }
        selectedLat = e.latlng.lat;
        selectedLng = e.latlng.lng;
        currentMarker = L.marker([selectedLat, selectedLng]).addTo(map);
        
        document.getElementById('coord-display').textContent = `Lat: ${selectedLat.toFixed(4)}, Lng: ${selectedLng.toFixed(4)}`;
    });

    // Form Submission
    const form = document.getElementById('eventForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnSpinner = document.getElementById('btnSpinner');
    const btnText = submitBtn.querySelector('span');
    const resultsPanel = document.getElementById('resultsPanel');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // UI State: Loading
        submitBtn.disabled = true;
        btnText.textContent = 'Analyzing...';
        btnSpinner.style.display = 'block';
        resultsPanel.classList.add('hidden');

        // Gather Data
        const payload = {
            event_cause: document.getElementById('event_cause').value,
            priority: document.getElementById('priority').value,
            requires_road_closure: false,
            start_datetime: document.getElementById('start_datetime').value.replace('T', ' ') + ':00',
            latitude: selectedLat,
            longitude: selectedLng
        };

        try {
            const response = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to fetch predictions');
            }

            const data = await response.json();
            
            // Update UI
            updateDashboard(data);

        } catch (error) {
            console.error("Prediction Error:", error);
            alert("Error: " + error.message);
        } finally {
            // Restore UI State
            submitBtn.disabled = false;
            btnText.textContent = 'Forecast Impact';
            btnSpinner.style.display = 'none';
        }
    });

    function updateDashboard(data) {
        // Show panel
        resultsPanel.classList.remove('hidden');

        // Update Severity
        const sevText = document.getElementById('severityText');
        const sevBadge = document.getElementById('severityBadge');
        
        sevText.textContent = data.predicted_severity;
        
        // Reset classes
        sevBadge.className = 'severity-badge';
        sevBadge.classList.add(`severity-${data.predicted_severity}`);

        // Update Recommendations
        document.getElementById('manpowerResult').textContent = data.recommendations.Manpower;
        document.getElementById('barricadingResult').textContent = data.recommendations.Barricading;
        document.getElementById('diversionResult').textContent = data.recommendations.DiversionPlan;
    }

    // Set default datetime to now
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('start_datetime').value = now.toISOString().slice(0, 16);
});
