FROM nginx:alpine

# Dashboard file
COPY index.html /usr/share/nginx/html/index.html

# Fixed nginx config — no variable substitution, listens on 8080
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
