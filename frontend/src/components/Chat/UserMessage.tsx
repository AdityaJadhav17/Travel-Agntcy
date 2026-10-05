/**
 * Copyright AGNTCY Contributors (https://github.com/agntcy)
 * SPDX-License-Identifier: Apache-2.0
 **/

import React from "react"
import { User } from "lucide-react"

interface UserMessageProps {
  content: string
}

const UserMessage: React.FC<UserMessageProps> = ({ content }) => {
  return (
    <div className="flex w-full flex-row items-start gap-3">
      <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-gray-600">
        <User size={16} className="text-white" />
      </div>

      <div className="flex flex-1 flex-col items-start justify-center rounded p-1">
        <div className="font-inter text-sm leading-6 font-normal wrap-break-word whitespace-pre-wrap text-gray-100">
          {content}
        </div>
      </div>
    </div>
  )
}

export default UserMessage
