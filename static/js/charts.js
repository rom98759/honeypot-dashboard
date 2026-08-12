let timelineChart = null;

export function renderTimelineChart(canvas, timeline) {
  const labels = timeline.map((t) => t.hour);
  const values = timeline.map((t) => t.n);
  if (timelineChart) {
    timelineChart.destroy();
  }
  timelineChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Connexions",
          data: values,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "#e5e7eb" } },
      },
    },
  });
}
