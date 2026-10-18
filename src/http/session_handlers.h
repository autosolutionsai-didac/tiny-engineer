#pragma once

#include <WebServer.h>

void handleSessionPost(WebServer& server);
void handleSessionsGet(WebServer& server);
void handleSessionsClear(WebServer& server);
bool isSessionPath(const String& uri);
