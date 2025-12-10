"use client";

import React from "react";
import { useConvexQuery } from "@/hooks/use-convex-query";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

const GroupMembers = ({ members }) => {
  const { data: currentUser } = useConvexQuery(api.users.getCurrentUser);
  if (!members || members.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        No members in this group
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {members.map((member) => {
        const isCurrentUser = member.id === currentUser?._id;
        const isAdmin = member.role === "admin";

        return (
          <div key={member.id} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Avatar className="flex items-center gap-2">
                <AvatarImage src={member.imageUrl} />
                <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {member.name}
                  </span>

                  {isCurrentUser && (
                    <Badge variant="outline" className="text-sx py-0 h-5">
                      You
                    </Badge>
                  )}
                </div>
                
                {isAdmin &&(
                        <span className="text-xs text-muted-foreground">Admin</span>
                    )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default GroupMembers;
