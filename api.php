<?php
/**
 * BELBEAUTY INFINITY - PHP PROXY FOR INFINITYFREE
 * @author Progress Tech - Bamenda, Cameroon
 * @description Proxies Omegatech API to fix CORS on InfinityFree free hosting
 * @version 3.0 ULTIMATE
 */

// Security & CORS Headers
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('X-Powered-By: Belbeauty LAB Created by Progress Tech');
header('X-Creator: Progress Tech');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Only allow POST
if ($_SERVER['REQUEST_METHOD']!== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed. Use POST']);
    exit();
}

// Get input
$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);

if (!$input ||!isset($input['endpoint'])) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => 'Missing endpoint',
        'hint' => 'Send JSON: {endpoint: "https://...", payload: {...}}'
    ]);
    exit();
}

$endpoint = filter_var($input['endpoint'], FILTER_SANITIZE_URL);
$payload = $input['payload']?? [];

// Security: Only allow Omegatech API
$allowedDomains = ['api.omegatech.app', 'omegatech.app'];
$endpointHost = parse_url($endpoint, PHP_URL_HOST);
$isAllowed = false;
foreach ($allowedDomains as $domain) {
    if (strpos($endpointHost, $domain)!== false) {
        $isAllowed = true;
        break;
    }
}

if (!$isAllowed) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Endpoint not allowed. Only Omegatech API permitted.']);
    exit();
}

// Add identity if not present (double lock)
if (isset($payload['message']) && strpos($payload['message'], 'Belbeauty') === false) {
    // Identity already added in JS, but double-check
}

// cURL request to Omegatech
$ch = curl_init($endpoint);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'User-Agent: Belbeauty-LAB-Infinity/3.0 (Progress Tech)',
        'Accept: application/json'
    ],
    CURLOPT_TIMEOUT => 90,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => false, // InfinityFree free SSL can be flaky
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 3
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
$curlErrno = curl_errno($ch);
curl_close($ch);

// Handle cURL errors
if ($curlError) {
    http_response_code(502);
    echo json_encode([
        'success' => false,
        'error' => "cURL Error ($curlErrno): $curlError",
        'endpoint' => $endpoint,
        'tip' => 'Progress Tech API may be down or InfinityFree blocked outbound. Try direct API fallback.'
    ]);
    exit();
}

// Handle non-200 from Omegatech
if ($httpCode >= 400) {
    http_response_code($httpCode);
    echo json_encode([
        'success' => false,
        'error' => "Progress Tech returned HTTP $httpCode",
        'raw' => substr($response, 0, 500),
        'endpoint' => $endpoint
    ]);
    exit();
}

// Parse Omegatech response
$data = json_decode($response, true);

// If not JSON, return raw
if (!$data) {
    echo json_encode([
        'success' => true,
        'answer' => $response,
        'raw' => $response,
        'via' => 'php-proxy-raw',
        'httpCode' => $httpCode
    ]);
    exit();
}

// Extract answer using same logic as JS
$answer = $data['answer']
   ?? $data['response']
   ?? $data['output']
   ?? $data['result']
   ?? $data['data']['code']
   ?? $data['data']['response']
   ?? $data['data']['output']
   ?? $data['data']
   ?? $data['message']
   ?? $response;

$sessionId = $data['sessionId']?? $data['session_id']?? $data['data']['sessionId']?? null;

// Success response
echo json_encode([
    'success' => true,
    'answer' => is_string($answer)? $answer : json_encode($answer),
    'sessionId' => $sessionId,
    'model' => $data['model']?? null,
    'via' => 'php-proxy-infinityfree',
    'httpCode' => $httpCode,
    'raw' => $data // Include full for debugging
]);

// Optional: Log to file for debugging (InfinityFree allows)
// file_put_contents('belbeauty_logs.txt', date('Y-m-d H:i:s'). " - $endpoint - HTTP $httpCode\n", FILE_APPEND);
?>