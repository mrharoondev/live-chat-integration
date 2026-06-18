<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Returns signed identity for NilaQ Live Chat secure mode when a valid Sanctum Bearer token is sent.
 * Guests (no token) receive identity: null so live-chat-sdk can boot as anonymous.
 */
class NilaqChatIdentityController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $this->optionalUserFromBearer($request);
        if (! $user) {
            return response()->json(['identity' => null]);
        }

        $secure = (bool) config('services.nilaq.secure_mode', false);
        $secret = trim((string) config('services.nilaq.secure_secret', ''));

        if (! $secure || $secret === '') {
            return response()->json([
                'identity' => [
                    'external_id' => (string) $user->id,
                    'email' => $user->email,
                    'name' => $user->name,
                    'user_hash' => null,
                ],
            ]);
        }

        $externalId = (string) ($user->id ?? '');
        $email = strtolower(trim((string) ($user->email ?? '')));
        $identifier = $externalId !== '' ? $externalId : $email;

        if ($identifier === '') {
            return response()->json(['identity' => null]);
        }

        return response()->json([
            'identity' => [
                'external_id' => $externalId !== '' ? $externalId : null,
                'email' => $user->email,
                'name' => $user->name,
                'user_hash' => hash_hmac('sha256', $identifier, $secret),
            ],
        ]);
    }

    private function optionalUserFromBearer(Request $request): ?User
    {
        $token = $request->bearerToken();
        if (! $token) {
            return null;
        }

        $accessToken = PersonalAccessToken::findToken($token);
        if (! $accessToken || ! $accessToken->tokenable instanceof User) {
            return null;
        }

        return $accessToken->tokenable;
    }
}
