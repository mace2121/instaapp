#!/bin/bash
TOKEN=$(cat token.txt)
echo "----------------------------------------"
echo "TEST 1: IP Address URL"
echo "URL: http://168.231.125.93:3000/uploads/2eca2c7b514f0a62ef1c3414.jpg"
http_code=$(curl -s -o response_ip.json -w "%{http_code}" -X POST "https://graph.facebook.com/v19.0/17841480646481230/media?access_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"image_url":"http://168.231.125.93:3000/uploads/2eca2c7b514f0a62ef1c3414.jpg","caption":"Test User Image"}')
echo "HTTP Status: $http_code"
cat response_ip.json
echo ""

echo "----------------------------------------"
echo "TEST 2: Public Domain URL"
echo "URL: https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Image_created_with_a_mobile_phone.png/640px-Image_created_with_a_mobile_phone.png"
http_code=$(curl -s -o response_domain.json -w "%{http_code}" -X POST "https://graph.facebook.com/v19.0/17841480646481230/media?access_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Image_created_with_a_mobile_phone.png/640px-Image_created_with_a_mobile_phone.png","caption":"Test Domain"}')
echo "HTTP Status: $http_code"
cat response_domain.json
echo ""
echo "----------------------------------------"
