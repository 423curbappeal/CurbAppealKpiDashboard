FROM nginx:alpine

# Remove default nginx static content
RUN rm -rf /usr/share/nginx/html/*

# Copy the app
COPY index.html /usr/share/nginx/html/index.html

# Railway sets $PORT dynamically — template the nginx config at container start
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=8080

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
