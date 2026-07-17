FROM nginx:alpine

# Copy the dashboard file in as the site's homepage
COPY ["CurbAppeal-KPI-Tracker (2).html", "/usr/share/nginx/html/index.html"]

# Nginx listens on 80 by default — Railway maps this automatically
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
